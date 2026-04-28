# Insighta CLI

## Installation
npm install -g .

## Usage

### Auth
insighta login       # Login with GitHub OAuth
insighta logout      # Clear credentials
insighta whoami      # Show current user

### Profiles
insighta profiles list
insighta profiles list --gender male
insighta profiles list --country NG --age-group adult
insighta profiles list --min-age 25 --max-age 40
insighta profiles list --sort-by age --order desc
insighta profiles list --page 2 --limit 20
insighta profiles search "young males from nigeria"
insighta profiles create --name "Harriet Tubman"
insighta profiles export --format csv

## Token Handling
- Tokens stored at ~/.insighta/credentials.json
- Access token expires in 3 minutes
- Refresh token expires in 5 minutes
- CLI auto-refreshes token before expiry
- If refresh fails, user is prompted to login again

## Authentication Flow (PKCE)
1. `insighta login` generates state + code_verifier + code_challenge
2. Opens browser to GitHub OAuth
3. Local server captures callback at http://localhost:9999
4. Sends code + code_verifier to backend
5. Backend returns access + refresh tokens
6. Tokens saved to ~/.insighta/credentials.json

## Role Enforcement
- Admin: can create profiles, export, list, search
- Analyst: can list, search, export only
- Unauthorized actions return clear error messages