#!/usr/bin/env node

const { Command } = require('commander');
const axios = require('axios');
const chalk = require('chalk');
const open = require('open');
const Conf = require('conf');
const http = require('http');

const config = new Conf({ projectName: 'insighta' });
const BASE_URL = 'http://35.180.66.115:3000/api/v1';

const program = new Command();

program
  .name('insighta')
  .description('Insighta Labs CLI')
  .version('1.0.0');

// ─── LOGIN ────────────────────────────────────
program
  .command('login')
  .description('Login with GitHub OAuth')
  .action(async () => {
    console.log(chalk.blue('Opening GitHub login in your browser...'));

    const loginUrl = `${BASE_URL}/auth/github`;
    await open(loginUrl);

    console.log(chalk.yellow('Waiting for authentication...'));

    // Start local server to catch callback token
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost:9999');
      const token = url.searchParams.get('access_token');
      const refresh = url.searchParams.get('refresh_token');

      if (token) {
        config.set('access_token', token);
        config.set('refresh_token', refresh);
        console.log(chalk.green('✅ Login successful!'));
        res.end('Login successful! You can close this tab.');
        server.close();
      } else {
        res.end('Waiting...');
      }
    });

    server.listen(9999);
  });

// ─── WHOAMI ───────────────────────────────────
program
  .command('whoami')
  .description('Show current logged in user')
  .action(async () => {
    const token = config.get('access_token');
    if (!token) {
      console.log(chalk.red('Not logged in. Run: insighta login'));
      return;
    }

    try {
      const res = await axios.get(`${BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const user = res.data.data;
      console.log(chalk.green(`Logged in as: ${user.username} (${user.role})`));
    } catch {
      console.log(chalk.red('Session expired. Run: insighta login'));
    }
  });

// ─── PROFILES ─────────────────────────────────
program
  .command('profiles')
  .description('Get profiles with optional filters')
  .option('--gender <gender>', 'Filter by gender')
  .option('--country <country_id>', 'Filter by country ID')
  .option('--age-group <age_group>', 'Filter by age group')
  .option('--min-age <min_age>', 'Minimum age')
  .option('--max-age <max_age>', 'Maximum age')
  .option('--page <page>', 'Page number', '1')
  .option('--limit <limit>', 'Results per page', '10')
  .action(async (opts) => {
    const token = config.get('access_token');
    if (!token) {
      console.log(chalk.red('Not logged in. Run: insighta login'));
      return;
    }

    try {
      const params = {};
      if (opts.gender) params.gender = opts.gender;
      if (opts.country) params.country_id = opts.country;
      if (opts.ageGroup) params.age_group = opts.ageGroup;
      if (opts.minAge) params.min_age = opts.minAge;
      if (opts.maxAge) params.max_age = opts.maxAge;
      params.page = opts.page;
      params.limit = opts.limit;

      const res = await axios.get(`${BASE_URL}/profiles`, {
        headers: { Authorization: `Bearer ${token}` },
        params,
      });

      const { data, total, page, limit } = res.data;
      console.log(chalk.blue(`\nTotal: ${total} | Page: ${page} | Limit: ${limit}\n`));
      data.forEach(p => {
        console.log(chalk.white(`${p.name} | ${p.gender} | Age: ${p.age} | ${p.country_name}`));
      });
    } catch (err) {
      console.log(chalk.red('Error: ' + (err.response?.data?.message || err.message)));
    }
  });

// ─── SEARCH ───────────────────────────────────
program
  .command('search <query>')
  .description('Natural language search')
  .action(async (query) => {
    const token = config.get('access_token');
    if (!token) {
      console.log(chalk.red('Not logged in. Run: insighta login'));
      return;
    }

    try {
      const res = await axios.get(`${BASE_URL}/profiles/search`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { q: query },
      });

      const { data, total } = res.data;
      console.log(chalk.blue(`\nTotal results: ${total}\n`));
      data.forEach(p => {
        console.log(chalk.white(`${p.name} | ${p.gender} | Age: ${p.age} | ${p.country_name}`));
      });
    } catch (err) {
      console.log(chalk.red('Error: ' + (err.response?.data?.message || err.message)));
    }
  });

// ─── LOGOUT ───────────────────────────────────
program
  .command('logout')
  .description('Logout and clear credentials')
  .action(() => {
    config.clear();
    console.log(chalk.green('Logged out successfully!'));
  });

program.parse();