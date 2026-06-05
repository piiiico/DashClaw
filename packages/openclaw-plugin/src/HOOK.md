---
name: dashclaw-governance
description: Policy enforcement, human-in-the-loop approval, and decision recording for every OpenClaw tool call. Powered by DashClaw.
version: 1.3.2
---

# DashClaw Governance Hook

Intercepts every OpenClaw tool call through a four-step governance loop:

1. **Guard** — `before_tool_call` sends the tool name, risk score, and a 500-character parameter summary to DashClaw `/api/guard`. Policies decide `allow`, `warn`, `block`, or `require_approval`.
2. **Record** — On `allow`/`warn`/`require_approval`, the hook opens a governance record via `/api/actions`. The server is authoritative — it may upgrade an `allow` decision to `pending_approval` for capabilities that require human review.
3. **Wait** — For `pending_approval` actions, the hook calls `waitForApproval(action_id)` using the **action_records ID from step 2**, not the `guard_decisions` ID from step 1. Operators approve from the DashClaw dashboard, CLI, or mobile PWA.
4. **Outcome** — `after_tool_call` records `completed` or `failed` with the error message, giving DashClaw a full intent → policy → outcome trail.

On the first tool call of a run the plugin also opens a DashClaw **Agent Session** (`POST /api/sessions`), and closes it (`PATCH /api/sessions/:id` → `status: completed`) on `agent_end`, so each OpenClaw run appears under the Agent Sessions feature. Session calls are fully fail-safe — a session error never blocks a tool call or the run.

The hook never modifies tool parameters or results. It only blocks, allows, waits, or records.

## x402 capability spend

When a tool call is an **x402 payment** (by default, a `bash`/`exec` command matching the agentcash `fetch` subcommand — configurable via `x402CommandPatterns` / `x402ToolNames`), it takes a dedicated path instead of the generic loop above, so the payment shows up on DashClaw's **Spend → x402** surface:

1. **Gate (before payment)** — `before_tool_call` calls `guard()` with `action_type: 'x402_purchase'`, the endpoint origin as `provider`, and a pre-payment estimate (the command's `--max-amount`, an `amount` param, or `x402EstimatedCostUsd`). An `x402_spend_limit` policy can `block`/`require_approval` an over-budget purchase **before** the agentcash call runs. (`require_approval` blocks inline with a message to adjust the policy — per-micropayment human approval is intentionally not prompted.)
2. **Record (after settlement)** — `after_tool_call` parses the agentcash success envelope from the tool result (`data.costDollars.total` → spend, `metadata.payment.transactionHash`, `data.requestId`) and records it via `recordPurchase()` (POST `/api/x402/purchases`) + `recordPurchaseResult()` for the receipt snapshot. With `x402AutoRegisterProviders` (default on), the origin is looked up or registered as a provider so the spend groups by provider.

Only settled payments are recorded — a free `agentcash check`, a 402-not-paid route, or a tool error records nothing. The agent always performs the payment itself; DashClaw guards and records it (govern-not-do). Set `x402Enabled: false` to disable this path entirely.

### Pay-outside-a-hook (self-report)

This path only fires for payments OpenClaw proxies through its tool-call hooks. If your agent pays through a runtime the gateway doesn't proxy — e.g. a Codex native `shell_command`, or a wrapper the harness runs directly — the hooks never fire, so the plugin can neither gate nor record the payment. The paying code must then **self-report** the settled spend via the SDK so it still lands on Spend → x402: `claw.recordX402Purchase({ agent_id, provider, spend, transaction_hash?, request_id? })` (Python: `record_x402_purchase`). The server resolves the provider from the `provider` name, so no client-side registration is needed. This records after settlement (no pre-payment gate); to keep the gate, route the paid call through an OpenClaw-native tool so `before_tool_call` fires.

## Configuration

The plugin accepts three interchangeable configuration shapes — pick whichever fits your deployment:

1. **Canonical plugin-config keys** (recommended for `openclaw.plugin.json`): `dashclawUrl` + `dashclawApiKey`.
2. **SDK-style aliases** (matches the DashClaw Node SDK): `baseUrl` + `apiKey`.
3. **Environment variables** (recommended when secrets live outside the gateway config): `DASHCLAW_BASE_URL` (or legacy `DASHCLAW_URL`) + `DASHCLAW_API_KEY`.

Precedence is `plugin config > env vars`. If env vars are set before the gateway starts, the plugin config can omit URL and API key entirely.

See the `configSchema` section in `openclaw.plugin.json` for the full list of optional fields (`agentId`, `failClosed`, `riskScoreDefault`, `highRiskTools`).

## Failure modes

- If `createAction` fails and `failClosed=true` (default), the tool call is blocked with a clear reason.
- If `failClosed=false`, the tool call proceeds ungoverned with a warning in the console.
- If the guard verdict is `block`, no action record is opened — the tool call is hard-stopped and no governance row is created.

## See also

- Canonical HITL flow: `sdk/README.md` → Human-in-the-Loop (HITL) Approval Flow
- Plugin source: `src/index.ts`
- Config schema: `openclaw.plugin.json`
