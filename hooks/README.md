# DashClaw Hooks for Claude Code

Two Python hook scripts that connect Claude Code to your DashClaw governance policies. 40+ governed tools with semantic classification are evaluated against your DashClaw guard before execution. After execution, the outcome is recorded as evidence. No SDK instrumentation or code changes required in your project. Just drop the hooks in and set your environment variables.

## v2 Intelligence Module

Hooks now use the `dashclaw_agent_intel` Python module for semantic classification of tool calls. This module is vendored alongside the hooks and requires only the Python standard library (zero external dependencies).

The intelligence module comprises five submodules:

- **bash_classifier**: Parses shell commands and classifies intent (e.g., destructive, network, filesystem, git) with structured validation results.
- **file_scanner**: Scans file paths and content for security-sensitive patterns (secrets, credentials, env files, auth configs).
- **tool_recognizer**: Maps Claude Code tool names to semantic categories and determines governance scope.
- **session_tracker**: Tracks session state across tool calls (cumulative risk, failure counts, branch staleness).
- **mcp_monitor**: Monitors MCP server health, latency, and degradation signals.

## Tool Governance Scope

v2 hooks classify every Claude Code tool into a semantic category and govern based on that category.

**Default governed categories:**

| Category | Example tools |
|---|---|
| `execution` | Bash, BashBackground |
| `orchestration` | Agent, Skill, TodoWrite |
| `file_io` | Edit, Write, MultiEdit, NotebookEdit |
| `interactive` | WebFetch, RemoteTrigger |
| `mcp` | Any `mcp__*` tool call |

**Default ungoverned categories:**

| Category | Example tools |
|---|---|
| `search` | Read, Glob, Grep |
| `system` | EnterPlanMode, ExitPlanMode, Config, Sleep |

Configure which categories are governed via the `DASHCLAW_GOVERNED_CATEGORIES` environment variable (comma-separated list). Unknown tools that do not match any category fail-safe to governed.

## Enriched Intel Context

The pretool hook builds an intel dict for every governed tool call and includes it in the guard request. This gives the guard server rich context for policy decisions.

The intel dict contains:

- **bash**: Intent classification, parsed command structure, and validation results (for Bash tools only).
- **file**: Security scan results for file paths and content patterns (for file_io tools).
- **tool**: Semantic category, governance permission, and tool metadata.
- **mcp**: MCP server health, latency, and degradation signals (for mcp tools).
- **session**: Cumulative session state including risk score, failure count, and branch info.

Example guard request with intel:

```json
{
  "agent_id": "claude-code",
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf /tmp/build"
  },
  "tool_use_id": "toolu_abc123",
  "intel": {
    "bash": {
      "intent": "destructive",
      "parsed": {
        "executable": "rm",
        "args": ["-rf", "/tmp/build"]
      },
      "validations": ["recursive_delete", "force_flag"]
    },
    "tool": {
      "category": "execution",
      "governed": true
    },
    "session": {
      "cumulative_risk": 42,
      "failure_count": 0,
      "branch": "feat/cleanup"
    }
  }
}
```

## Installation

### Recommended: one-command install

From the DashClaw repo root:

```bash
node scripts/install-hooks.mjs
# or, in any project that has DashClaw cloned alongside it:
node /path/to/DashClaw/scripts/install-hooks.mjs --target=.
```

This copies all three hook scripts (`dashclaw_pretool.py`, `dashclaw_posttool.py`, `dashclaw_stop.py`) and the vendored `dashclaw_agent_intel/` Python module into `.claude/hooks/`, then merges the matching `PreToolUse` / `PostToolUse` / `Stop` entries into `.claude/settings.json`. Re-run after `git pull` to refresh.

### Manual install

```bash
mkdir -p .claude/hooks
cp hooks/dashclaw_pretool.py .claude/hooks/
cp hooks/dashclaw_posttool.py .claude/hooks/
cp hooks/dashclaw_stop.py    .claude/hooks/
cp -r hooks/dashclaw_agent_intel .claude/hooks/
```

The intel module is required — `dashclaw_pretool.py` imports `dashclaw_agent_intel` for semantic tool classification, so omitting it causes an `ImportError` on the first governed tool call.

Then merge the hooks block from `hooks/settings.json` into your `.claude/settings.json`. If you do not have a settings file yet, copy it directly:

```bash
cp hooks/settings.json .claude/settings.json
```

### Environment variables

```bash
export DASHCLAW_BASE_URL=https://your-dashclaw-instance.vercel.app
export DASHCLAW_API_KEY=your_api_key_here
export DASHCLAW_AGENT_ID=claude-code   # optional, defaults to "claude-code"
```

### Smoke test

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_use_id":"test_001","session_id":"smoke"}' \
  | python .claude/hooks/dashclaw_pretool.py
```

If DashClaw is reachable, the hook evaluates the command against your guard policies. If not, it exits silently and Claude Code proceeds normally.

### Token capture (Stop hook)

`dashclaw_stop.py` runs at the end of every assistant turn. It reads the session transcript, sums LLM token usage across that turn's assistant messages (with cache-read tokens weighted at 0.1× to match real Anthropic billing), and PATCHes `tokens_in`, `tokens_out`, and `model` onto each action_id the pretool opened during the turn. Cost is derived server-side from the configured pricing table.

The Stop hook also auto-closes any action still in `status='running'` at turn end (PostToolUse safety net) — terminal statuses written by PostToolUse are preserved, never overwritten. See [`docs/ANALYTICS-ROLLOUT.md`](../docs/ANALYTICS-ROLLOUT.md) for the full data flow.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `DASHCLAW_BASE_URL` | Yes | -- | URL of your DashClaw instance |
| `DASHCLAW_API_KEY` | Yes | -- | Operator API key from `/settings` |
| `DASHCLAW_AGENT_ID` | No | `claude-code` | Identity for this agent in DashClaw |
| `DASHCLAW_HOOK_MODE` | No | `enforce` | `enforce` blocks on policy violations. `observe` logs everything but never blocks. |
| `DASHCLAW_RISK_THRESHOLD` | No | `60` | Commands with risk above this threshold get elevated risk scores |
| `DASHCLAW_PERMISSION_MODE` | No | `danger` | Permission mode passed to the guard for policy evaluation |
| `DASHCLAW_GOVERNED_CATEGORIES` | No | `execution,orchestration,file_io,interactive,mcp` | Comma-separated list of tool categories that are governed |
| `DASHCLAW_GUARD_TIMEOUT` | No | `5` | Timeout in seconds for each guard API request attempt. The hook retries up to three times before declaring the guard unreachable. |
| `DASHCLAW_GUARD_UNAVAILABLE_POLICY` | No | `block` | Behavior when the guard is unreachable after retries. `block` fails closed (exits 2). `warn` prints a stderr warning and proceeds. `allow` proceeds silently. All three paths still write the orphan log for backfill. |
| `DASHCLAW_APPROVAL_TIMEOUT` | No | `30` | Timeout in seconds when polling for operator approval |
| `DASHCLAW_DISABLE_DOTENV` | No | unset | Test isolation escape hatch. When set to any truthy value, the hooks skip the `.env` walk so the subprocess only sees env vars the caller passes in. The hook test suite sets this. **Never set this in production**: it disables the standard `.env.local` and `.env` loading the install flow relies on. |

## Behavior

The PreToolUse hook calls `POST /api/guard` before each governed tool executes. The guard returns one of four decisions:

- **allow**: The tool proceeds. An action record is created for the evidence trail.
- **warn**: The tool proceeds. A warning is printed to the Claude Code terminal. An action record is created.
- **block**: In enforce mode, the tool is blocked and Claude Code sees the policy reason. In observe mode, the warning is logged but the tool proceeds.
- **require_approval**: In enforce mode, an action record is created in `pending_approval` status. The hook prints the action ID and a replay link, then polls for up to 30 seconds waiting for an operator to approve or deny. If approved, the tool proceeds. If denied or timed out, the tool is blocked. In observe mode, the action is recorded but the tool proceeds immediately.

The PostToolUse hook runs after execution completes. It updates the action record with the outcome (completed or failed) and a summary of the output (up to 500 characters). The hook sends structured `outcome_metadata` including `exit_code` and `error_type` when applicable. Errors are classified into four types: `timeout`, `permission`, `not_found`, and `runtime`. The posttool hook never blocks.

If DashClaw is unconfigured (`DASHCLAW_BASE_URL` or `DASHCLAW_API_KEY` missing), the hooks exit silently and Claude Code operates normally. If DashClaw is configured but unreachable, behavior is governed by `DASHCLAW_GUARD_UNAVAILABLE_POLICY` (default `block`). See the Failure safety section below for the full policy table. The hooks never crash your session.

## Failure safety

If `DASHCLAW_BASE_URL` or `DASHCLAW_API_KEY` is unset, both scripts exit 0 silently and Claude Code is never blocked.

If DashClaw is configured but the API is unreachable (timeout, network error, 5xx) after three retry attempts with exponential backoff, behavior is governed by `DASHCLAW_GUARD_UNAVAILABLE_POLICY`:

| Policy value | Behavior on unreachable guard |
|---|---|
| `block` (default) | Hook exits 2, the tool call is blocked, the action is logged to `~/.dashclaw/orphan-actions.jsonl` for backfill when the guard recovers. |
| `warn` | Hook prints a stderr warning, the action is logged, the tool proceeds. |
| `allow` | Hook is silent, the action is logged, the tool proceeds. |

The `block` default is correct for production governance posture: destructive actions should not proceed without a guard check. For development environments or single operator setups, `warn` is often the better choice. Set it in your environment:

```bash
export DASHCLAW_GUARD_UNAVAILABLE_POLICY=warn
```

The hooks retry transient failures up to three times with 0.4 second and 0.8 second backoff between attempts before concluding the guard is unreachable, so most cold start blips on Vercel and Neon are absorbed automatically.

## Approving from the terminal

When a tool call requires approval, the hook prints the action ID:

```
[DashClaw] Approval required
Action ID: act_abc123
Goal:      Bash: git push origin main
...
Approve from terminal: dashclaw approve act_abc123
```

If you have the `@dashclaw/cli` package installed, run `dashclaw approve act_abc123` from another terminal to approve inline. You can also approve from the DashClaw dashboard at `/approvals`. The replay link printed in the terminal (`<DASHCLAW_BASE_URL>/replay/<action_id>`) opens the full decision evidence in your browser.

## Recovery Context

Guard responses now include an optional `recovery` field when the intel signals indicate a recoverable issue. When present, the recovery context contains a recipe type and suggested actions for the operator or agent.

Six recovery recipe types are supported:

| Recipe | Trigger |
|---|---|
| `session_stalled` | Session has high failure count or repeated blocked actions |
| `branch_stale` | Working branch is significantly behind the base branch |
| `mcp_degraded` | One or more MCP servers report high latency or errors |
| `repeated_failures` | The same tool or command has failed multiple times in sequence |
| `green_insufficient` | Test coverage or passing rate has dropped below threshold |
| `assumption_drift` | Agent behavior has diverged from the declared plan or goal |

The recovery field is informational. It does not block tool execution on its own but gives operators and agents structured guidance to self-correct.

## What gets governed

All tools in governed categories are evaluated against DashClaw policies. With the default `DASHCLAW_GOVERNED_CATEGORIES`, this includes:

- **execution**: Bash, BashBackground. Shell commands are enriched with bash intent classification. Git operations, deployments, infrastructure commands, destructive operations, and HTTP calls get elevated risk scores.
- **file_io**: Edit, Write, MultiEdit, NotebookEdit. File operations are enriched with security scan results. Sensitive files (`.env`, secrets, credentials), migrations, infrastructure configs, and auth-related files get elevated risk scores.
- **orchestration**: Agent, Skill, TodoWrite. Subagent and skill invocations are governed to maintain oversight of delegated work.
- **interactive**: WebFetch, RemoteTrigger. Network-facing interactive tools are governed by default.
- **mcp**: Any `mcp__*` tool call. MCP tool calls are enriched with server health signals.

Unknown tools that do not match any configured category fail-safe to governed.

## What does not get governed

- Tools in ungoverned categories: **search** (Read, Glob, Grep) and **system** (EnterPlanMode, ExitPlanMode, Config, Sleep) pass through without evaluation by default.
- Any tool call when `DASHCLAW_BASE_URL` or `DASHCLAW_API_KEY` is not set.

Configured but unreachable behavior is controlled by `DASHCLAW_GUARD_UNAVAILABLE_POLICY` (see Failure safety above). With the default `block` policy, unreachable means the tool call is denied, not waived.

## Replay

Every governed action creates a replayable evidence record in DashClaw. Visit `<DASHCLAW_BASE_URL>/replay/<action_id>` to see the full causal chain: what the agent intended, which policy was matched, whether approval was required, who approved it, and what the outcome was. This works for both allowed and blocked actions, giving operators a complete audit trail of what Claude Code did and why.
