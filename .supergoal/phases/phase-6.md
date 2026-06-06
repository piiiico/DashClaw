SUPERGOAL_PHASE_START
Phase: 6 of 14 — x402 repository + API conversion (PARENT money + consistency)
Task: Convert x402 governance to TS preserving governance order, status lifecycle, redaction, and the no-payment boundary.
Type: brownfield, refactor
Mandatory commands: npm run typecheck, npm run lint, npx vitest run, npm run route-sql:check
Acceptance criteria: 6
Evidence required: governance-order test, redaction test, route-sql:check exit 0
Depends on phases: 2, 3, 4, 5
Cleanliness override: converting modules that retain existing operator `console.error`/`console.warn`; NO net-new debug prints.

## Why
x402 is the payment-governance pillar: DashClaw governs/records but NEVER executes payments or holds wallet credentials. Preserve that boundary and the action↔purchase consistency window.

## Work
- See ROADMAP.md "Phase 6". Authoritative: spec §13 (§13.1 lifecycle, §13.2 governance order, §13.3 consistency, §13.4 payment security).
- Convert `x402.repository.ts`; `app/api/x402/providers/route.ts`, `providers/[id]/route.ts`, endpoint route(s), `purchases/route.ts`; type the SDK x402 methods' contracts.
- Typed lifecycle (proposed/blocked/pending/approved/running/succeeded/failed/partial) with explicit action-status↔execution-status mapping (no silent drift). Preserve mask of wallet_reference/payment_reference before persist. Preserve x402_spend_limit allow/block by name OR provider_id, max_spend, approval_threshold (spend from cost_estimate).
- Investigate (don't "fix") the orphan-action / outcome-sync consistency window; preserve current compatibility; document a typed consistency strategy. NO new cross-table FK (spec §13.3).

## Acceptance criteria (all must pass — verify each in transcript)
- `npm run typecheck` + `npm run lint` clean
- Test: governance order preserved (identity→validate→provider/endpoint→guard→persist decision→block/approve/create action→create purchase→agent executes→record outcome)
- Assert NO payment-execution / wallet-credential / signing / private-key path exists in DashClaw code (boundary grep + reasoning)
- Test: wallet_reference/payment_reference masked before persist; x402_spend_limit name-OR-id allow/block preserved
- x402-scoped `npx vitest run` passes
- `npm run route-sql:check` exit 0 (no new direct SQL)

## Mandatory commands (run each, surface last ~10 lines + exit code)
- npm run typecheck
- npm run lint
- npx vitest run (x402-scoped this phase)
- npm run route-sql:check

## Evidence required in transcript
- governance-order test; no-payment-boundary grep/reasoning; redaction test; route-sql:check exit 0

## Notes
PARENT owns money/currency + final integration. Do not add wallet custody or payment execution (spec §22 approval gate).
