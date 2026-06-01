import { headers } from 'next/headers';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import PublicNavbar from '../../components/PublicNavbar';
import PublicFooter from '../../components/PublicFooter';
import GuideClient from '../GuideClient';
import { getGuideBaseUrl } from '../../lib/guideContent';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Claude Code Integration Guide - DashClaw',
  description: 'Govern Claude Code tool calls with DashClaw in under 20 minutes.',
};

export default async function ClaudeCodeGuidePage() {
  const headerStore = await headers();
  const host = headerStore.get('host') || 'localhost:3000';
  const baseUrl = getGuideBaseUrl(host);

  const hookSettingsJson = `{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Agent|Task|Bash|Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "python .claude/hooks/dashclaw_pretool.py",
            "timeout": 3600000
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Agent|Task|Bash|Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "python .claude/hooks/dashclaw_posttool.py"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python .claude/hooks/dashclaw_stop.py"
          }
        ]
      }
    ]
  }
}`;

  const guardrailsYaml = `version: 1
project: my-claude-code-project
description: >
  Governance policy for Claude Code tool calls.
  Blocks destructive shell commands. Warns on deployment.

policies:
  - id: block_destructive_shell
    description: Block rm -rf and database drops
    applies_to:
      tools:
        - Bash
    rule:
      block: true
    when:
      command_contains:
        - "rm -rf"
        - "drop table"

  - id: warn_on_deploy
    description: Require approval for deployment commands
    applies_to:
      tools:
        - Bash
    rule:
      require: approval
    when:
      command_contains:
        - "git push"
        - "vercel deploy"`;

  const discordEnvBlock = `DISCORD_BOT_TOKEN=<token>
DISCORD_PUBLIC_KEY=<64-char-hex>
DISCORD_APPROVER_USER_ID=<numeric-user-id>
DISCORD_APPROVER_ORG_ID=<your-org-id>
# Kill switch — leave unset or set to true to enable DMs
# DASHCLAW_ALERTS_DISCORD=false`;

  const steps = [
    {
      number: 1,
      title: 'Watch the 3-minute walkthrough',
      summary:
        'See the full install → first approval round-trip end to end. Skip if you prefer to follow the written steps below.',
      note: 'Screencast: <SCREENCAST_URL>',
    },
    {
      number: 2,
      title: 'Deploy DashClaw',
      summary: 'Get a running instance. Click the Vercel deploy button or run locally.',
      note: 'Already have an instance? Skip to Step 3.',
    },
    {
      number: 3,
      title: 'Install the hook scripts',
      summary: 'One command copies all three governance hooks (PreToolUse, PostToolUse, Stop), the vendored intel module that powers semantic tool classification, and merges the matching settings.json blocks. Re-run after each git pull to upgrade.',
      codeTitle: 'Terminal',
      codeBody: `# From the DashClaw repo root:
npm run hooks:install

# Or from any other project, pointing at a checked-out DashClaw clone:
node /path/to/DashClaw/scripts/install-hooks.mjs --target=.

# Manual fallback (skips settings merge):
mkdir -p .claude/hooks
cp hooks/dashclaw_pretool.py  .claude/hooks/
cp hooks/dashclaw_posttool.py .claude/hooks/
cp hooks/dashclaw_stop.py     .claude/hooks/
cp -r hooks/dashclaw_agent_intel .claude/hooks/`,
    },
    {
      number: 4,
      title: 'Set environment variables',
      summary: 'Claude Code reads these from the shell or a .env file in the project root. DASHCLAW_GUARD_UNAVAILABLE_POLICY defaults to block, which fails closed if the guard is unreachable after three retry attempts. Set it to warn for development if you would rather proceed with a stderr warning when the guard is down.',
      codeTitle: '.env',
      codeBody: `DASHCLAW_BASE_URL=${baseUrl}
DASHCLAW_API_KEY=oc_live_...
DASHCLAW_HOOK_MODE=enforce
DASHCLAW_GUARD_UNAVAILABLE_POLICY=block
DASHCLAW_GUARD_TIMEOUT=5`,
    },
    {
      number: 5,
      title: 'Add hooks to Claude Code settings',
      summary:
        'Merge this into your project\'s .claude/settings.json (or ~/.claude/settings.json for global).',
      codeTitle: '.claude/settings.json',
      codeBody: hookSettingsJson,
    },
    {
      number: 6,
      title: 'Connect Discord (2 minutes)',
      summary:
        'A Discord bot turns your phone into a one-tap approval surface for risky tool calls. The built-in Discord adapter posts a DM with Approve / Deny buttons when a policy requires human judgment. Telegram parity; ENV-only setup.',
      codeTitle: '.env.local (or Vercel env vars)',
      codeBody: discordEnvBlock,
      note:
        'Step-by-step Discord Developer Portal walkthrough is printed below.',
    },
    {
      number: 7,
      title: 'Run Claude Code and trigger a tool call',
      summary:
        'Ask Claude Code to do anything that uses Bash, Edit, Write, or MultiEdit. The hook fires automatically. For policies that require approval, your phone will DM you.',
      codeTitle: 'Example prompt',
      codeBody: 'Create a file called hello.txt with the contents "Hello from a governed agent"',
      note: 'Watch the terminal — you should see [DashClaw] messages as the hook evaluates the action.',
    },
    {
      number: 8,
      title: 'See the result in DashClaw',
      summary: 'Open your DashClaw dashboard to confirm the action was recorded.',
      note: "Go to /decisions — you should see your tool call in the ledger with action_type 'other' (for a simple file write) or 'security' (for sensitive files), status 'completed'. Approvals that ran through Discord show approved_by starting with 'discord:'.",
    },
  ];

  const discordPortalWalkthrough = `## Discord Developer Portal walkthrough

### Create the bot
- Open https://discord.com/developers/applications -> New Application
- Name the app; skip the Installation tab
- Open the "Bot" tab -> Reset Token -> copy as DISCORD_BOT_TOKEN
- Open "General Information" -> copy the Public Key as DISCORD_PUBLIC_KEY
- Under "Privileged Gateway Intents" leave ALL off (button-only bot)

### Invite the bot to a mutual server (so DMs work)
- Open "OAuth2" -> URL Generator -> scopes: "bot" -> permissions: "Send Messages"
- Paste the URL in a browser, invite the bot to a personal test server
- In Discord client, enable Developer Mode (Settings -> Advanced)
- Right-click your own user in the member list -> Copy User ID
- Paste as DISCORD_APPROVER_USER_ID

### Register the interactions endpoint
- In "General Information" set:
  Interactions Endpoint URL: https://<your-deployment>/api/discord/interactions
- Discord sends a PING; DashClaw responds {type:1} and the URL saves.

### Verify
- Trigger a Claude Code tool call that hits an approval-required policy
- Your phone's Discord app lights up; tap Approve or Deny
- The DM edits in place to show APPROVED or DENIED with timestamp`;

  const proofMoment =
    "Go to /decisions — you should see your Claude Code tool call in the ledger. Look for action_type 'other' or 'security' with agent_id 'claude-code' and status 'completed'.";

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <PublicNavbar />

      <main className="px-6 pb-20 pt-28">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex items-center gap-2 text-sm text-tertiary">
            <Link href="/" className="transition-colors hover:text-secondary">
              Home
            </Link>
            <ChevronRight size={14} />
            <Link href="/connect" className="transition-colors hover:text-secondary">
              Connect
            </Link>
            <ChevronRight size={14} />
            <span className="text-secondary">Claude Code</span>
          </div>

          <GuideClient
            frameworkName="Claude Code"
            frameworkIcon="🤖"
            steps={steps}
            proofMoment={proofMoment}
            guardrailsYaml={guardrailsYaml}
            baseUrl={baseUrl}
          />

          <section className="mt-6 rounded-3xl border border-[rgba(255,255,255,0.08)] bg-[#111] p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.32em] text-tertiary">
              Discord setup
            </p>
            <pre className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-secondary">
              {discordPortalWalkthrough}
            </pre>
          </section>

          <section className="mt-6 rounded-3xl border border-[rgba(255,255,255,0.08)] bg-[#0a0a0a] p-6">
            <p className="text-xs uppercase tracking-[0.32em] text-tertiary">
              Watch the 3-minute walkthrough
            </p>
            <p className="mt-3 text-sm text-secondary">
              End-to-end install to first Discord approval. Published on
              Loom / YouTube (Unlisted) — backfilled by plan 02-01 once
              recorded.
            </p>
            <p className="mt-3 font-mono text-xs text-tertiary">
              Screencast: &lt;SCREENCAST_URL&gt;
            </p>
          </section>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
