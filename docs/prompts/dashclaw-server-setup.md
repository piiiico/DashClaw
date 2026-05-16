# DashClaw: One-Command Setup (Dashboard Server Machine)

You are helping a non-technical user self-host the DashClaw dashboard. The user wants the easiest path possible.

Rules:
- Do NOT ask the user to paste secrets into chat. If a secret must be entered, instruct them to paste it only into their terminal.
- Never exfiltrate `.env.local` contents.
- If you can run shell commands on the user's machine, do so. If you cannot, provide exact copy/paste commands for the user.

Goal:
- Get DashClaw running at `http://localhost:3000` (or the user's chosen host URL).
- Produce a short "Agent Connect" snippet the user can paste into any agent machine:
  - `DASHCLAW_BASE_URL=...`
  - `DASHCLAW_API_KEY=...`

## Step 0: Confirm Where We Are Installing

Ask the user:
1. Are we setting up the dashboard on THIS machine (the server host)?
2. Are we on Windows or Mac/Linux?

Proceed once confirmed.

## Step 1: Install Prereqs

Ensure:
- Node.js 20+
- npm 10+

If missing, instruct the user to install Node.js LTS from `https://nodejs.org`.

## Step 2: Get DashClaw

```bash
git clone https://github.com/ucsandman/DashClaw.git
cd DashClaw
```

## Step 3: Run the Interactive Setup

One command handles everything — database choice, secrets, dependencies, migrations, and build:

```bash
node scripts/setup.mjs
```

The setup script will:
1. Ask for a database (Docker local, Neon cloud, or custom Postgres URL)
2. Ask about deployment mode (local or cloud/Vercel)
3. Auto-generate all secrets (API key, auth secret, encryption key)
4. Install dependencies
5. Run all database migrations (with progress spinners)
6. Build the Next.js app

For cloud deployments, it prints all the Vercel env vars ready to copy-paste.

Platform-specific wrappers (check for Node.js first):
- Windows: `./install-windows.bat`
- Mac/Linux: `bash ./install-mac.sh`

## Step 4: Choose How to Sign In

### Option A: Admin Password (fastest — no OAuth app required)

Add to `.env.local`:

    DASHCLAW_LOCAL_ADMIN_PASSWORD=your-strong-password-here

Visit the login page and sign in with your password.

### Option B: GitHub OAuth (required for team access)

1. Go to https://github.com/settings/developers → New OAuth App
2. Callback URL:
   - Local: `http://localhost:3000/api/auth/callback/github`
   - Cloud: `https://your-app.vercel.app/api/auth/callback/github`
3. Add `GITHUB_ID` and `GITHUB_SECRET` to `.env.local`

## Step 5: Start the Dashboard

```bash
npm run dev
```

Note: `npm run dev` uses Turbopack and is for development. For production, run `npm run build` followed by `npm start`.

Open `http://localhost:3000` -- redirects to login. Sign in with the method you set up in Step 4 (admin password or GitHub).

## Step 6: Capture The Two Values Agents Need

The setup script prints these at the end, but you can also find them in `.env.local`:

```bash
# Put these on each agent machine
DASHCLAW_BASE_URL=http://localhost:3000  # or https://your-app.vercel.app
DASHCLAW_API_KEY=oc_live_...
DASHCLAW_AGENT_ID=<unique-per-agent>  # optional but recommended
```

## Step 7: Sanity Check

From any machine that can reach the dashboard host:
- `GET {DASHCLAW_BASE_URL}/api/health` should return healthy JSON.

You can also install the CLI to verify: `npm install -g @dashclaw/cli && dashclaw help`

If the dashboard is deployed publicly:
- Ensure `DASHCLAW_API_KEY` is set on the server.
- Never expose `DATABASE_URL` to agents.
