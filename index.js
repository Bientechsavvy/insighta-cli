#!/usr/bin/env node

const { Command } = require('commander');
const axios = require('axios');
const chalk = require('chalk');
const open = require('open');
const Conf = require('conf');
const http = require('http');
const crypto = require('crypto');
const path = require('path');

const config = new Conf({ projectName: 'insighta' });
const BASE_URL = 'http://35.180.66.115:3000/api/v1';

const program = new Command();

program
  .name('insighta')
  .description('Insighta Labs CLI')
  .version('1.0.0');

// ─── PKCE HELPERS ─────────────────────────────
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

// ─── API HELPER (auto refresh) ────────────────
async function apiRequest(method, url, data = null, params = null) {
  const token = config.get('access_token');
  if (!token) {
    console.log(chalk.red('Not logged in. Run: insighta login'));
    process.exit(1);
  }

  try {
    const res = await axios({
      method,
      url: `${BASE_URL}${url}`,
      data,
      params,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-API-Version': '1',
      },
    });
    return res.data;
  } catch (err) {
    if (err.response?.status === 401) {
      // Try refresh
      const refreshToken = config.get('refresh_token');
      if (!refreshToken) {
        console.log(chalk.red('Session expired. Run: insighta login'));
        process.exit(1);
      }
      try {
        const refreshRes = await axios.post(`${BASE_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        });
        config.set('access_token', refreshRes.data.access_token);
        config.set('refresh_token', refreshRes.data.refresh_token);

        // Retry original request
        const retry = await axios({
          method,
          url: `${BASE_URL}${url}`,
          data,
          params,
          headers: {
            Authorization: `Bearer ${refreshRes.data.access_token}`,
            'X-API-Version': '1',
          },
        });
        return retry.data;
      } catch {
        console.log(chalk.red('Session expired. Run: insighta login'));
        process.exit(1);
      }
    }
    throw err;
  }
}

// ─── LOGIN ────────────────────────────────────
program
  .command('login')
  .description('Login with GitHub OAuth (PKCE)')
  .action(async () => {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    config.set('pkce_verifier', codeVerifier);
    config.set('pkce_state', state);

    const params = new URLSearchParams({
      client_id: '',
      redirect_uri: 'http://localhost:9999/callback',
      scope: 'user:email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const loginUrl = `${BASE_URL}/auth/github?state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    console.log(chalk.blue('Opening GitHub login in your browser...'));
    console.log(chalk.gray(`Login URL: ${loginUrl}`));

    await open(loginUrl);

    console.log(chalk.yellow('Waiting for authentication...'));

    await new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost:9999');

        if (url.pathname !== '/callback') {
          res.end('Waiting...');
          return;
        }

        const returnedState = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        const accessToken = url.searchParams.get('access_token');
        const refreshToken = url.searchParams.get('refresh_token');

        // If tokens come directly in URL
        if (accessToken) {
          config.set('access_token', accessToken);
          config.set('refresh_token', refreshToken);
          res.end('<h2>Login successful! You can close this tab.</h2>');
          server.close();
          console.log(chalk.green('✅ Logged in successfully!'));
          resolve();
          return;
        }

        // Validate state
        const savedState = config.get('pkce_state');
        if (returnedState !== savedState) {
          res.end('State mismatch. Please try again.');
          server.close();
          reject(new Error('State mismatch'));
          return;
        }

        if (!code) {
          res.end('No code received.');
          server.close();
          reject(new Error('No code'));
          return;
        }

        try {
          const tokenRes = await axios.post(`${BASE_URL}/auth/github/token`, {
            code,
            code_verifier: config.get('pkce_verifier'),
            state,
          });

          config.set('access_token', tokenRes.data.access_token);
          config.set('refresh_token', tokenRes.data.refresh_token);
          res.end('<h2>Login successful! You can close this tab.</h2>');
          server.close();
          console.log(chalk.green(`✅ Logged in successfully!`));
          resolve();
        } catch (err) {
          res.end('Authentication failed.');
          server.close();
          reject(err);
        }
      });

      server.listen(9999, () => {
        console.log(chalk.gray('Local callback server started on port 9999'));
      });

      server.on('error', reject);

      // Timeout after 2 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('Login timeout'));
      }, 120000);
    });

    // Show who logged in
    try {
      const me = await apiRequest('get', '/auth/me');
      console.log(chalk.green(`Logged in as @${me.data.username} (${me.data.role})`));
    } catch {}
  });

// ─── WHOAMI ───────────────────────────────────
program
  .command('whoami')
  .description('Show current logged in user')
  .action(async () => {
    try {
      const res = await apiRequest('get', '/auth/me');
      const user = res.data;
      console.log(chalk.green(`\n👤 Username: ${user.username}`));
      console.log(chalk.blue(`   Role:     ${user.role}`));
      console.log(chalk.gray(`   Email:    ${user.email || 'N/A'}`));
    } catch (err) {
      console.log(chalk.red('Error: ' + (err.response?.data?.message || err.message)));
    }
  });

// ─── LOGOUT ───────────────────────────────────
program
  .command('logout')
  .description('Logout and clear credentials')
  .action(async () => {
    try {
      const refreshToken = config.get('refresh_token');
      if (refreshToken) {
        await axios.post(`${BASE_URL}/auth/logout`, { refresh_token: refreshToken });
      }
    } catch {}
    config.clear();
    console.log(chalk.green('✅ Logged out successfully!'));
  });

// ─── PROFILES COMMAND GROUP ───────────────────
const profiles = program.command('profiles').description('Profile commands');

// profiles list
profiles
  .command('list')
  .description('List profiles with optional filters')
  .option('--gender <gender>', 'Filter by gender')
  .option('--country <country_id>', 'Filter by country ID')
  .option('--age-group <age_group>', 'Filter by age group')
  .option('--min-age <min_age>', 'Minimum age')
  .option('--max-age <max_age>', 'Maximum age')
  .option('--sort-by <sort_by>', 'Sort by field', 'created_at')
  .option('--order <order>', 'Sort order', 'asc')
  .option('--page <page>', 'Page number', '1')
  .option('--limit <limit>', 'Results per page', '10')
  .action(async (opts) => {
    try {
      console.log(chalk.blue('⏳ Fetching profiles...'));
      const params = {};
      if (opts.gender) params.gender = opts.gender;
      if (opts.country) params.country_id = opts.country;
      if (opts.ageGroup) params.age_group = opts.ageGroup;
      if (opts.minAge) params.min_age = opts.minAge;
      if (opts.maxAge) params.max_age = opts.maxAge;
      params.sort_by = opts.sortBy || 'created_at';
      params.order = opts.order;
      params.page = opts.page;
      params.limit = opts.limit;

      const res = await apiRequest('get', '/profiles', null, params);
      const { data, total, page, limit, total_pages } = res;

      console.log(chalk.blue(`\nTotal: ${total} | Page: ${page}/${total_pages} | Limit: ${limit}\n`));
      console.log(chalk.white('─'.repeat(80)));
      console.log(chalk.bold(
        'Name'.padEnd(25) +
        'Gender'.padEnd(10) +
        'Age'.padEnd(6) +
        'Age Group'.padEnd(12) +
        'Country'
      ));
      console.log(chalk.white('─'.repeat(80)));
      data.forEach(p => {
        console.log(
          p.name.padEnd(25) +
          p.gender.padEnd(10) +
          String(p.age).padEnd(6) +
          p.age_group.padEnd(12) +
          p.country_name
        );
      });
      console.log(chalk.white('─'.repeat(80)));
    } catch (err) {
      console.log(chalk.red('Error: ' + (err.response?.data?.message || err.message)));
    }
  });

// profiles get
profiles
  .command('get <id>')
  .description('Get a profile by ID')
  .action(async (id) => {
    try {
      const res = await apiRequest('get', `/profiles/${id}`);
      const p = res.data;
      console.log(chalk.green('\n Profile Details'));
      console.log(chalk.white('─'.repeat(40)));
      Object.entries(p).forEach(([key, val]) => {
        console.log(`${chalk.bold(key.padEnd(20))}: ${val}`);
      });
    } catch (err) {
      console.log(chalk.red('Error: ' + (err.response?.data?.message || err.message)));
    }
  });

// profiles search
profiles
  .command('search <query>')
  .description('Natural language search')
  .action(async (query) => {
    try {
      console.log(chalk.blue(`⏳ Searching for: "${query}"...`));
      const res = await apiRequest('get', '/profiles/search', null, { q: query });
      const { data, total } = res;

      console.log(chalk.blue(`\nTotal results: ${total}\n`));
      console.log(chalk.white('─'.repeat(80)));
      console.log(chalk.bold(
        'Name'.padEnd(25) +
        'Gender'.padEnd(10) +
        'Age'.padEnd(6) +
        'Age Group'.padEnd(12) +
        'Country'
      ));
      console.log(chalk.white('─'.repeat(80)));
      data.forEach(p => {
        console.log(
          p.name.padEnd(25) +
          p.gender.padEnd(10) +
          String(p.age).padEnd(6) +
          p.age_group.padEnd(12) +
          p.country_name
        );
      });
      console.log(chalk.white('─'.repeat(80)));
    } catch (err) {
      console.log(chalk.red('Error: ' + (err.response?.data?.message || err.message)));
    }
  });

// profiles create
profiles
  .command('create')
  .description('Create a new profile (admin only)')
  .requiredOption('--name <name>', 'Name of the person')
  .action(async (opts) => {
    try {
      console.log(chalk.blue(`⏳ Creating profile for "${opts.name}"...`));
      const res = await apiRequest('post', '/profiles', { name: opts.name });
      const p = res.data;
      console.log(chalk.green('\n✅ Profile created!'));
      console.log(chalk.white('─'.repeat(40)));
      Object.entries(p).forEach(([key, val]) => {
        console.log(`${chalk.bold(key.padEnd(20))}: ${val}`);
      });
    } catch (err) {
      console.log(chalk.red('Error: ' + (err.response?.data?.message || err.message)));
    }
  });

// profiles export
profiles
  .command('export')
  .description('Export profiles to CSV')
  .option('--format <format>', 'Export format', 'csv')
  .option('--gender <gender>', 'Filter by gender')
  .option('--country <country_id>', 'Filter by country')
  .action(async (opts) => {
    try {
      console.log(chalk.blue('⏳ Exporting profiles...'));
      const token = config.get('access_token');
      const params = new URLSearchParams();
      if (opts.gender) params.set('gender', opts.gender);
      if (opts.country) params.set('country_id', opts.country);

      const res = await axios.get(
        `${BASE_URL}/profiles/export?${params}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-API-Version': '1',
          },
          responseType: 'text',
        }
      );

      const fs = require('fs');
      const filename = `profiles_export_${Date.now()}.csv`;
      fs.writeFileSync(path.join(process.cwd(), filename), res.data);
      console.log(chalk.green(`✅ Exported to ${filename}`));
    } catch (err) {
      console.log(chalk.red('Error: ' + (err.response?.data?.message || err.message)));
    }
  });

program.parse();