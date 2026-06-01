# Minimal Runtime API (v2.13.3)

DashClaw is a focused governance runtime. These endpoints are the smallest useful contract for agents and agent frameworks that want DashClaw governance without adopting DashClaw's higher-level UI, workflow, scoring, knowledge, or capability surfaces.

This page documents the minimal runtime contract. For the complete generated route inventory, see [`../api-inventory.md`](../api-inventory.md). For durable outcome semantics, see [`durable-execution-finality.md`](./durable-execution-finality.md).

## The Governance Loop

A fully governed action usually follows this flow:

1. **Guard** (`POST /api/guard`) -> "Can I do this?"
2. **Record** (`POST /api/actions`) -> "I am doing this."
3. **Assumption** (`POST /api/assumptions`) -> "This belief matters while I act." Optional, but recommended when reasoning integrity matters.
4. **Outcome** (`POST /api/actions/:actionId/outcome`) -> "This actually completed, partially completed, or failed."

`PATCH /api/actions/:actionId` still exists for legacy lifecycle updates, but the current durable-finality path is `POST /api/actions/:actionId/outcome` plus `GET /api/actions/:actionId/outcome` for polling.

---

## Core Endpoints

### 1. Guard (`POST /api/guard`)

Evaluates active guard policies for a proposed action. It does not execute the action. It returns `allow`, `warn`, `block`, or `require_approval`.

Risk scores are computed server-side from structured fields such as `action_type`, `reversible`, `systems_touched`, and `declared_goal`. The agent-supplied `risk_score` is advisory. DashClaw uses the higher of the computed score and the agent-reported score, then may apply predictive-risk adjustment when enabled. The response returns both `risk_score` (authoritative/effective) and `agent_risk_score` (raw agent-supplied value, or `null`).

Prompt-injection scanning runs against `declared_goal` before guard evaluation and can reject malicious input with `400`.

**Request:**
```json
{
  "action_type": "deploy",
  "declared_goal": "Deploy build #402 to production",
  "risk_score": 85,
  "agent_id": "deploy-agent-1",
  "agent_name": "Deploy Agent",
  "systems_touched": ["production"],
  "reversible": false
}
```

**Response:**
```json
{
  "decision": "allow | warn | block | require_approval",
  "decision_id": "act_gd_...",
  "action_id": "act_gd_...",
  "reason": "Risk score exceeds org threshold",
  "signals": ["Production access", "High risk score"],
  "matched_policies": ["pol_..."],
  "risk_score": 85,
  "agent_risk_score": 85,
  "evaluated_at": "2026-05-13T02:57:00.000Z",
  "reasons": ["Risk score exceeds org threshold"],
  "warnings": []
}
```

`decision_id` is the canonical id of this guard evaluation (`act_gd_…`). `action_id` is a **deprecated alias** of the same value, kept for back-compat. Do not pass either to `waitForApproval` / `GET /api/actions/:id` — use the `action_id` returned by `POST /api/actions` (an `act_…` id) for follow-up calls.

`GET /api/guard` lists recent guard decisions and supports filters such as `agent_id`, `decision`, `limit`, and `offset`.

### 2. Actions (`POST /api/actions`)

Records an action in the DashClaw ledger. This endpoint also runs guard evaluation internally. If policy blocks the action, DashClaw creates a blocked action record and returns `403`. If approval is required, the action is created with `status: "pending_approval"`.

Required fields are `agent_id`, `action_type`, and `declared_goal`.

`idempotency_key` is optional but strongly recommended for durable execution. If a row already exists for `(org_id, idempotency_key)`, DashClaw returns the existing action with `idempotent_replay: true` instead of inserting a duplicate.

**Request:**
```json
{
  "agent_id": "deploy-agent-1",
  "agent_name": "Deploy Agent",
  "action_type": "deploy",
  "declared_goal": "Deploy build #402 to production",
  "authorization_scope": "production deploy for service api",
  "risk_score": 85,
  "systems_touched": ["production"],
  "reversible": false,
  "idempotency_key": "sha256:..."
}
```

**Allowed lifecycle statuses:**
```text
running, completed, failed, cancelled, pending, pending_approval, blocked
```

Agent-reported cost and token values are clamped server-side. If `tokens_in` or `tokens_out` are provided without an explicit `cost_estimate`, DashClaw estimates cost from the configured pricing table.

### 3. Durable Outcomes (`POST /api/actions/:actionId/outcome`)

Records the terminal outcome of an action. This is the current durable-finality endpoint and should be preferred over legacy `PATCH /api/actions/:actionId` completion updates.

Allowed agent-reported terminal states are:

```text
completed, partial, failed
```

`lost_confirmation` is reserved for the system sweep at `/api/cron/outcome-sweep`.

**Completed request:**
```json
{
  "status": "completed",
  "summary": "Success: build #402 is live."
}
```

**Failed request:**
```json
{
  "status": "failed",
  "summary": "Deploy did not complete.",
  "error_message": "Health check failed after rollout."
}
```

**Partial request:**
```json
{
  "status": "partial",
  "summary": "Deploy started but manual cleanup is required.",
  "progress": {
    "completed_steps": ["image pushed", "rollout started"],
    "remaining_steps": ["rollback or finish rollout"]
  }
}
```

Rules:

- `error_message` is required when `status` is `failed`.
- `progress` object is required when `status` is `partial`.
- First terminal outcome wins.
- A later POST returns `409 { "error": "outcome already set", "current_status": "..." }`.
- Summary, error, and progress strings are secret-scanned/redacted before storage.

`GET /api/actions/:actionId/outcome` returns the current outcome state, including elapsed time where available.

### 4. Assumptions (`POST /api/assumptions`)

Records beliefs underpinning an action. Assumptions are useful for drift detection, auditability, and post-action review.

The parent action must exist. DashClaw returns `404` if `action_id` is unknown.

**Request:**
```json
{
  "action_id": "act_...",
  "assumption": "The staging tests passed successfully.",
  "basis": "CI run 402 was green before deploy."
}
```

**Response:**
```json
{
  "assumption": {
    "assumption_id": "asm_...",
    "action_id": "act_...",
    "assumption": "The staging tests passed successfully.",
    "basis": "CI run 402 was green before deploy."
  },
  "assumption_id": "asm_...",
  "security": {
    "clean": true,
    "findings_count": 0,
    "critical_count": 0,
    "categories": []
  }
}
```

`GET /api/assumptions` supports filters such as `action_id`, `agent_id`, `validated`, `stale`, `limit`, and `offset`. `drift=true` adds a drift summary.

---

## Minimal SDK Flow

The canonical Node SDK is `dashclaw` on npm. The app currently depends on SDK package `2.11.1`, and the canonical SDK file `sdk/dashclaw.js` exposes 87 public methods across the core runtime and extension surfaces.

The minimal governance loop uses only a small subset:

```javascript
import { DashClaw, GuardBlockedError } from 'dashclaw';

const claw = new DashClaw({ baseUrl, apiKey, agentId: 'deploy-agent-1' });

const decision = await claw.guard({
  action_type: 'deploy',
  declared_goal: 'Deploy build #402 to production',
  risk_score: 85,
});

if (decision.decision === 'block') {
  throw new GuardBlockedError(decision);
}

const { action, action_id } = await claw.createAction({
  action_type: 'deploy',
  declared_goal: 'Deploy build #402 to production',
  idempotency_key: claw.deriveIdempotencyKey({
    agent_id: 'deploy-agent-1',
    action_type: 'deploy',
    declared_goal: 'Deploy build #402 to production',
  }),
});

if (action?.status === 'pending_approval') {
  await claw.waitForApproval(action_id);
}

try {
  await deployBuild402();
  await claw.reportActionSuccess(action_id, 'Build #402 is live.');
} catch (error) {
  await claw.reportActionFailure(action_id, error.message);
  throw error;
}
```

See [`../../sdk/README.md`](../../sdk/README.md) for the full SDK catalogue and [`../sdk-parity.md`](../sdk-parity.md) for Node/Python parity status.

## Legacy Support

Legacy v1 paths are still routed through server-side rewrites in `next.config.js`:

- `/api/actions/signals` -> `/api/signals`
- `/api/actions/assumptions` -> `/api/assumptions`
- `/api/actions/assumptions/:assumptionId` -> `/api/assumptions/:assumptionId`
- `/api/actions/:actionId/approve` -> `/api/approvals/:actionId`

Both legacy and canonical paths are live. New integrations should target canonical routes.

## Optional Approval Channels

`waitForApproval()` resolves via any approval surface that posts to the same `/api/approvals/:actionId` endpoint:

- Dashboard approval queue and action detail surfaces
- CLI approval flows
- Mobile PWA approval route at `/approve`
- Telegram approvals when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID` are configured
- Discord/webhook approval bridges when configured

Telegram inbound callbacks hit `POST /api/telegram/webhook`. See [`../telegram-setup.md`](../telegram-setup.md) for setup.
