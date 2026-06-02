# DashClaw plugin

Governance and platform intelligence for your AI agents, packaged for one step install. It adds guard checks, action recording, approvals, policy discovery, and session tracking through the DashClaw MCP server, plus two skills that teach the agent how to operate and troubleshoot DashClaw.

This is a dual target plugin: the same source installs into both Claude Code and Codex CLI, keeping the recorded agent identity separate per ecosystem.

## What you get

- **dashclaw-governance** skill: the governance protocol. When to call guard, how to read allow / warn / block / require_approval decisions, when to record actions, how to wait on approvals, and session lifecycle. Loads your org policies and capabilities from MCP at session start.
- **dashclaw-platform-intelligence** skill: a DashClaw platform expert for integration and troubleshooting, covering the API surface, route inventory, and playbooks.
- **MCP server** (`@dashclaw/mcp-server`): the tool surface for guard checks, governed capability invocation, action recording, approval waits, policy discovery, and session start / end.

Hooks (PreToolUse / PostToolUse / Stop guards over Bash, Edit, Write, and MultiEdit) are intentionally not bundled, since they are filesystem artifacts that need Python on PATH. Install them separately (see below).

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

## Use it

Both skills are model invoked, so the agent pulls them in automatically when a task matches. Prompts to try:

- "Instrument this agent with DashClaw."
- "Should this action need approval? Run it through guard first."
- "Debug this DashClaw guard decision."
- "Show me the open loops and recent governed decisions."

A fast health check is the `dashclaw_capabilities_list` tool, the lightest way to confirm the connection is up.

## Optional: install the governance hooks

To enforce guard checks on Bash, Edit, Write, and MultiEdit at the tool layer:

```bash
node scripts/install-hooks.mjs
```

These write to `.claude/settings.json` and require Python on PATH.

## Validate before sharing

```bash
claude plugin validate ./plugins/dashclaw
```

## Links

- Homepage: https://dashclaw.io
- Docs: https://dashclaw.io/docs
- Repository: https://github.com/ucsandman/DashClaw
- License: MIT
