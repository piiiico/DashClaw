# /goal — DashClaw Policy System v2: Explainable, Testable Agent Governance

## Goal

Turn DashClaw policies from "opaque action gates" into an explainable, testable governance system that operators can understand before trusting.

By the end of this goal, a user should be able to answer these questions from the UI and API without reading code:

- What policies exist?
- Which agents do they apply to?
- What exact action fields do they inspect?
- Why did this action allow, warn, require approval, or block?
- Which policies matched, which were skipped, and why?
- Can I test a policy against sample actions before turning it on?
- Can I express structured conditions without hiding logic in an upstream app?

This goal is about **policy comprehension and correctness**, not cosmetic UI polish.

## Background / Problem

Current DashClaw policies work, but the mental model is too easy to misunderstand.

Today a policy row is roughly:

```txt
id, org_id, name, policy_type, rules JSON, active, agent_ids
```

When an agent creates an action through `POST /api/actions`, DashClaw calls `evaluateGuard()`, loads active policies, filters by `agent_id`, evaluates each policy, picks the strongest decision, writes a `guard_decisions` audit row, then creates the action as `running`, `pending_approval`, or `blocked`.

That enforcement path is real.

The weak part: most policies are simple metadata gates. They are good at:

```txt
"deploy requires approval"
"risk >= 80 blocks"
"this action_type is forbidden"
"more than N actions per window warns"
```

They are not yet good at declarative business logic like:

```txt
if input.confidence >= 0.95
and input.customer_verified == true
and input.placeholder_count == 0
then allow
else require approval
```

Today that richer logic must live upstream, or be approximated through `webhook_check` / `semantic_check` / custom action types. That is functional, but not trustworthy enough for a governance product unless DashClaw explains the boundary clearly and offers first-class condition policies.

## Non-Negotiables

- Do not deploy.
- Do not run destructive DB operations.
- Do not call production external services except safe local/dev DashClaw API calls needed for tests, and only if already configured for local/test.
- Do not reveal or rotate secrets.
- Preserve existing policy behavior and existing policy rows.
- Preserve org scoping via `getOrgId(request)` and existing API-key middleware.
- Preserve the repository pattern. Do not add new direct SQL in route handlers if an existing repository pattern applies.
- Preserve current decisions ordering: `allow < warn < require_approval < block`.
- Keep backwards compatibility for existing `risk_threshold`, `require_approval`, `block_action_type`, `rate_limit`, `webhook_check`, `behavioral_anomaly`, `semantic_check`, `permission_escalation`, `green_contract`, and `branch_freshness` policies.
- No fake passing tests. Tests must assert decision, matched/skipped policy behavior, and stored audit detail.
- Follow ZERO SLOP: no placeholder names, no mock-echo tests, no unverified claims.

## Source-of-Truth Files To Read First

Read these before editing:

- `CLAUDE.md`
- `PROJECT_DETAILS.md`
- `schema/schema.js`
- `app/lib/guard.js`
- `app/lib/validate.js`
- `app/api/actions/route.js`
- `app/api/guard/route.js`
- `app/api/policies/route.js`
- `app/api/policies/simulate/route.js`
- `app/api/policies/test/route.js`
- `app/api/policies/templates/route.js`
- `app/api/approvals/[actionId]/route.js`
- `app/lib/repositories/guard.repository.js`
- `app/lib/repositories/actions.repository.js`
- `app/policies/page.jsx`
- `app/policies/components/CustomTab.jsx`
- `app/policies/lib/policyFormModel.js`
- `app/actions/[actionId]/page.js`
- `app/approve/page.js`
- `app/approvals/page.jsx`
- `__tests__/integration/guard-pipeline.test.js`
- `__tests__/unit/actions.route.test.js`
- `__tests__/helpers.js`
- `docs/architecture/durable-execution-finality.md` for style/quality bar

## Current Behavior To Preserve

### Policy storage

`guard_policies` stores:

- `id`
- `org_id`
- `name`
- `policy_type`
- `rules` as JSON string
- `active` integer
- `agent_ids` as JSON-encoded string or null
- `created_by`
- timestamps

### Evaluation

`evaluateGuard(orgId, context, sql)` currently:

1. Selects active policies for the org.
2. Filters by `agent_ids`:
   - null/empty means all agents.
   - JSON array means only listed `agent_id`s.
   - malformed scope is skipped, not widened.
3. Computes authoritative server-side risk score.
4. Uses max(server risk, agent-reported risk).
5. Applies predictive risk adjustment if configured.
6. Evaluates policies.
7. Adds prompt-injection scan.
8. Evaluates webhook policies after local policies.
9. Persists `guard_decisions` with decision, reason, matched policies, context, risk score, action type.
10. Publishes real-time guard decision event.

### Action enforcement

`POST /api/actions` is the authoritative gate:

- `block` → creates blocked action record and returns 403.
- `require_approval` → creates action with `status='pending_approval'` and returns 202.
- `allow` / `warn` → creates action with `status='running'` unless caller supplied another status.

Do not weaken this.

## Required Work

### 1. Add explicit policy evaluation trace output

Add a structured trace from `evaluateGuard()` that explains every policy considered.

For each active policy in the org, record:

```ts
{
  policy_id: string,
  name: string,
  policy_type: string,
  active: boolean,
  scoped_to_agent: boolean,
  scope_reason: string,
  evaluated: boolean,
  matched: boolean,
  decision: 'allow' | 'warn' | 'require_approval' | 'block' | null,
  reason: string | null,
  inspected_fields?: string[],
  error?: string
}
```

Important:

- Include skipped policies and why they were skipped.
- Do not store secrets in traces. Reuse existing redaction behavior where context is stored.
- Keep the existing `matched_policies` array for backwards compatibility.
- Add a concise trace summary to the API response from `POST /api/guard` and `POST /api/actions`.
- Store enough trace detail in `guard_decisions` to power an action detail page. If schema change is needed, add a migration. If using existing `context` / `matched_policies`, justify why no schema change is needed.

### 2. Build a policy explain surface

Add UI affordances so an operator can understand a decision.

Minimum:

- Action detail page shows:
  - final guard decision
  - matched policy names
  - skipped policy count
  - why each matched policy matched
  - why the final decision won
- Policy list/detail shows:
  - policy type
  - active status
  - agent scope
  - normalized readable rule summary
  - what fields this policy type inspects
  - whether the policy is enforceable locally, webhook-backed, LLM-backed, or advisory

Do not rely on the current shorthand like:

```txt
foo.bar → require approval · 1 agents
```

That shorthand can remain, but it must not be the only explanation.

### 3. Add a first-class `condition` policy type

Implement a declarative structured condition policy.

Proposed policy type:

```txt
condition
```

Proposed rules shape:

```json
{
  "when": {
    "all": [
      { "path": "input.confidence", "op": "gte", "value": 0.95 },
      { "path": "input.customer_verified", "op": "eq", "value": true },
      { "path": "input.placeholder_count", "op": "eq", "value": 0 }
    ]
  },
  "on_match": "allow",
  "on_fail": "require_approval",
  "reason": "Submission is outside green-path thresholds"
}
```

Required operators:

- `eq`
- `neq`
- `gt`
- `gte`
- `lt`
- `lte`
- `includes`
- `exists`
- `not_exists`
- `regex` with safe bounded behavior

Required combinators:

- `all`
- `any`
- `not`

Path behavior:

- Dot paths into the action context, e.g. `action_type`, `risk_score`, `input.confidence`, `intel.green.observed_level`.
- Missing paths must be explicit in the trace.
- Do not use `eval` or dynamic function construction.
- Regex must be bounded and safely handled. Invalid regex makes the policy invalid at validation time.

Decision behavior:

- `on_match` and `on_fail` may be `allow`, `warn`, `require_approval`, or `block`.
- Default `on_match = allow`.
- Default `on_fail = require_approval`.
- If a condition policy returns `allow`, it should not downgrade a stronger decision from another policy.
- Strongest-decision ordering still wins globally.

Validation:

- Extend `validatePolicy()` to accept `condition`.
- Reject unknown operators.
- Reject missing/invalid `path`.
- Reject invalid `on_match` / `on_fail`.
- Reject dangerously huge rule bodies. Preserve existing max-length discipline or intentionally raise it with a documented reason.

### 4. Add policy simulation that explains, not just counts

Upgrade `/api/policies/simulate` and/or add a dedicated endpoint if cleaner.

A user should be able to paste a sample action context and see:

- final decision
- risk score
- matched policies
- skipped policies
- condition clause results
- approval/block reason

Suggested endpoint:

```txt
POST /api/policies/evaluate
```

Body:

```json
{
  "agent_id": "example-agent",
  "action_type": "deploy",
  "declared_goal": "Deploy production app",
  "input": { "confidence": 0.91 }
}
```

It should use the same evaluation logic as real action creation but must not create an `action_records` row.

Be careful: `POST /api/guard` already evaluates without creating an action. Prefer enhancing that if it is semantically right, instead of duplicating logic.

### 5. Add policy tests as first-class artifacts

Add a way to define test cases for a policy. Minimal implementation can be file/API based; UI can be basic.

A test case should include:

```json
{
  "name": "low confidence requires approval",
  "context": {
    "agent_id": "pullpermit-agent",
    "action_type": "pullpermit.submission",
    "input": { "confidence": 0.91 }
  },
  "expect": {
    "decision": "require_approval",
    "matched_policy_ids": ["gp_..."]
  }
}
```

Required:

- Tests can be run without creating real actions.
- Failure output explains expected vs actual.
- Include tests for skipped-by-scope, inactive, malformed rules, missing paths, and strongest-decision precedence.

Stretch if time allows:

- Persist policy test cases in DB.
- Show pass/fail in the policy detail UI.

### 6. Improve policy authoring UI

Extend the policy authoring form to support `condition` policies without forcing raw JSON for common cases.

Minimum acceptable:

- Advanced JSON mode for condition rules.
- Live validation errors.
- Human-readable preview summary.
- Agent scope selector preserved.
- Copy/export still works.

Better:

- Simple condition builder with add clause / operator / value controls.

Do not block the backend on perfect UI. Backend correctness matters more.

### 7. Update docs and examples

Update docs so the concept is clear.

Required docs:

- Explain the distinction between:
  - policy evaluation (`/api/guard`)
  - authoritative action creation (`/api/actions`)
  - human approval (`/api/approvals/:actionId`)
- Explain policy lifecycle:
  - create
  - scope to agents
  - simulate/evaluate
  - activate
  - action hits policy
  - approval/block outcome
- Explain each policy type in plain English.
- Add a real `condition` policy example.
- Add a "what policies are not" section: not magic, not retroactive, not automatically applied to already-running actions, and not a replacement for app-side validation unless the relevant fields are sent to DashClaw.

### 8. Verification gates

Run and report:

- `npm run lint`
- `npm test -- --run` or the repo's current full test command
- targeted guard/policy tests
- if docs inventory/check scripts exist, run them
- if route/sql guard scripts exist, run them

If any gate cannot run, explain why and what was run instead.

## Acceptance Criteria

This goal is complete when:

1. Existing policy behavior still passes tests.
2. A new `condition` policy type can express structured field checks.
3. Policy evaluation returns an explanation trace.
4. Action detail or policy UI exposes enough of that trace for a human to understand the decision.
5. Policy simulation/evaluation can test sample contexts without creating real actions.
6. At least one test proves `require_approval` still puts actions into `pending_approval`.
7. At least one test proves `condition` can require approval when a field fails.
8. At least one test proves a stronger `block` policy wins over an `allow` or `require_approval` condition policy.
9. Docs explain the system in terms a non-code operator can understand.
10. No production deploy or external account mutation occurred.

## Suggested Implementation Plan

### Phase 0 — Inspection

- Read all source-of-truth files.
- Write a short implementation note at the top of your work log describing current policy flow and any discovered drift from this goal.
- If this goal conflicts with current code, stop and append an addendum before coding.

### Phase 1 — Trace model

- Add trace construction to guard evaluation.
- Keep existing return fields stable.
- Add tests around scope filtering, matched policies, skipped policies, and strongest-decision ordering.

### Phase 2 — Condition evaluator

- Implement pure helper functions for path lookup and condition evaluation.
- Unit test the helper thoroughly.
- Wire into `evaluatePolicy()`.
- Extend validation.

### Phase 3 — API simulation/explain

- Enhance `POST /api/guard` response or add `POST /api/policies/evaluate`.
- Ensure no action record is created.
- Add route tests.

### Phase 4 — UI explainability

- Update policy UI summaries.
- Update action detail decision explanation.
- Keep UI minimal but honest.

### Phase 5 — Docs and gates

- Update docs.
- Run verification gates.
- Add a final implementation report with changed files, tests run, and known tradeoffs.

## Design Warnings

- Do not build a second policy engine. `evaluateGuard()` should remain the central path.
- Do not make `condition` policies silently inspect fields that are not sent by agents. Missing fields must appear in the trace.
- Do not let `allow` from one policy erase `require_approval` or `block` from another.
- Do not make policy simulation mutate state.
- Do not imply policies are retroactive. They affect new evaluations only.
- Do not overfit to PullPermit. PullPermit is an example, not the product.

## Final Report Format

When done, produce a concise report with:

```txt
Summary
Files changed
Policy types supported
New condition examples
Tests run
Known limitations
Recommended next step
```

