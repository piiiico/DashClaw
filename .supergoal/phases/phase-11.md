SUPERGOAL_PHASE_START
Phase: 11 of 14 — Test migration + regression coverage
Task: Convert tests to TS where practical and add the spec §18 regression matrix; never weaken assertions to pass.
Type: brownfield, refactor
Mandatory commands: npm run typecheck, npm run lint, npx vitest run
Acceptance criteria: 4
Evidence required: new test count vs 2846 baseline, §18 category→test mapping, vitest summary
Depends on phases: 4, 5, 6, 7, 8, 9, 10

## Why
Lock the invariants in with explicit regression tests so future drift fails loudly. Workers avoid editing production files.

## Work
- See ROADMAP.md "Phase 11". Authoritative: spec §18 (§18.1 identity/security, §18.2 actions/governance, §18.3 pricing/FinOps, §18.4 x402, §18.5 UI/compat).
- Convert tests to TS where practical; ADD coverage for each §18 item: forged identity, JWT-override, missing/invalid/expired/replayed tokens, action-binding mismatch, cross-tenant, missing org, invalid roles, secret redaction, prompt injection; authoritative-risk persistence, guard-persist-failure, blocked recording, approval conflicts, concurrent outcomes, idempotent creation, webhook timeout; every model rate, cache rates, unknown-model behavior, analytics fallback, custom org pricing, x402-exclusion, Fleet equation, Claude-code aggregation, period+lens allow-lists, no-repricing, no-rate-card-drift; x402 negative/NaN/blocklist/allowlist/max-spend/approval/missing-provider/invalid-endpoint/mismatch/idempotency/consistency/outcome-mapping/currency/wallet-redaction/cross-tenant/agent-executes-payment-boundary; FinOps response typing, spend pages, /spend/code chart data, /spend active-state, API compat, production route presence.

## Acceptance criteria (all must pass — verify each in transcript)
- `npm run typecheck` + `npm run lint` clean
- `npx vitest run` green with the test count INCREASED vs the 2846 baseline
- Each spec §18 category has ≥1 explicit test (mapping table in evidence)
- No assertions weakened merely to pass (spec §18 closing rule) — diff review confirms

## Mandatory commands (run each, surface last ~10 lines + exit code)
- npm run typecheck
- npm run lint
- npx vitest run

## Evidence required in transcript
- new test count vs 2846 baseline; §18 category→test mapping table; vitest summary

## Notes
Test phase — avoid editing production files unless a confirmed defect is found (then flag, don't silently expand scope).
