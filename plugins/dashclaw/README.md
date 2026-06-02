# DashClaw plugin

Governance and platform intelligence for your AI agents, packaged for one step install. It adds guard checks, action recording, approvals, policy discovery, and session tracking through the DashClaw MCP server, plus two skills that teach the agent how to operate and troubleshoot DashClaw.

This is a dual target plugin: the same source installs into both Claude Code and Codex CLI, keeping the recorded agent identity separate per ecosystem.

## What you get

- **dashclaw-governance** skill: the governance protocol. When to call guard, how to read allow / warn / block / require_approval decisions, when to record actions, how to wait on approvals, and session lifecycle. Loads your org policies and capabilities from MCP at session start.
- **dashclaw-platform-intelligence** skill: a DashClaw platform expert for integration and troubleshooting, covering the API surface, route inventory, and playbooks.
- **MCP server** (`@dashclaw/mcp-server`): the tool surface for guard checks, governed capability invocation, action recording, approval waits, policy discovery, and session start / end.

Hooks (PreToolUse / PostToolUse / Stop guards over Bash, Edit, Write, MultiEdit, sub-agent spawns (Agent/Task), and MCP tool calls (mcp__*) — so Gmail/Stripe/Calendar MCP sends are governed too) are intentionally not bundled, since they are filesystem artifacts that need Python on PATH. Install them separately (see below).

## Prerequisites

- Node.js 18+ on PATH (the MCP server runs via `npx -y @dashclaw/mcp-server`).
- A DashClaw instance and an API key, either self hosted or a hosted workspace.
- Python 3 on PATH only if you also install the optional hooks.

## Install (Claude Code)

Add the marketplace, then install the plugin:

```bash
claude plugin marketplace add ucsandman/DashClaw
claude plugin install dashclaw@dashclaw
```

Or from inside a Claude Code session:

```text
/plugin marketplace add ucsandman/DashClaw
/plugin install dashclaw@dashclaw
```

Reload to activate, then confirm the MCP tools are live:

```text
/reload-plugins
/mcp
```

## Configure

The MCP server reads its connection from environment variables:

| Variable | Purpose | Example |
| --- | --- | --- |
| `DASHCLAW_URL` | Base URL of your DashClaw instance | `https://your-workspace.example.com` |
| `DASHCLAW_API_KEY` | API key for the workspace | `oc_live_...` |
| `DASHCLAW_AGENT_ID` | Agent identity recorded for this session | `claude-code` |

Set these in your shell before launching, or add an `env` block to the plugin MCP config to pin them per install.

> **Heads-up on env-var names:** the MCP server reads `DASHCLAW_URL`, but the optional hooks (installed separately) read `DASHCLAW_BASE_URL` — different name, same value. Set BOTH if you install both, or the hooks exit silently and govern nothing.

## Use it

Both skills are model invoked, so the agent pulls them in automatically when a task matches. Prompts to try:

- "Instrument this agent with DashClaw."
- "Should this action need approval? Run it through guard first."
- "Debug this DashClaw guard decision."
- "Show me the open loops and recent governed decisions."

A fast health check is the `dashclaw_capabilities_list` tool, the lightest way to confirm the connection is up.

## Optional: install the governance hooks

To enforce guard checks on Bash, Edit, Write, MultiEdit, sub-agent spawns, and MCP tool calls (mcp__*) at the tool layer:

The hook installer ships in the DashClaw repo, **not** the marketplace package — clone the repo first, then point the installer at your project:

```bash
git clone https://github.com/ucsandman/DashClaw.git
node /path/to/DashClaw/scripts/install-hooks.mjs --target=/path/to/your/project
```

These write to `.claude/settings.json` and require Python on PATH, plus `DASHCLAW_BASE_URL` + `DASHCLAW_API_KEY` in the shell (note: `DASHCLAW_BASE_URL`, **not** `DASHCLAW_URL`).

## Troubleshooting

- **MCP tools listed but every call returns 401.** Your instance is on a stale schema. Run `npm run db:migrate` against it, then retry.
- **Tools don't appear after install.** Run `/reload-plugins`, then `/mcp`, and confirm `DASHCLAW_URL` + `DASHCLAW_API_KEY` are set in the environment the MCP server launches from.
- **MCP works but the hooks govern nothing.** The hooks read `DASHCLAW_BASE_URL`, not `DASHCLAW_URL` — set both (same value).
- **Guard always allows, or you see a demo-mode warning.** `DASHCLAW_BASE_URL` points at the demo instance. Set it to your real instance.
- **Fastest connectivity check.** Call the `dashclaw_capabilities_list` tool — the lightest way to confirm the connection is up.

## Validate before sharing

```bash
claude plugin validate ./plugins/dashclaw
```

## Links

- Homepage: https://dashclaw.io
- Docs: https://dashclaw.io/docs
- Repository: https://github.com/ucsandman/DashClaw
- License: MIT
