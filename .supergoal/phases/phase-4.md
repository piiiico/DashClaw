SUPERGOAL_PHASE_START
Phase: 4 of 14 — Pricing & FinOps foundation (PARENT money contract) [INTEGRATION GATE]
Task: Convert billing/pricing/finops to TS with a shared typed rate-card that preserves BOTH fallback semantics + the refresh-marker contract.
Type: brownfield, refactor
Mandatory commands: npm run typecheck, npm run lint, npx vitest run, node scripts/refresh-model-pricing.mjs
Acceptance criteria: 7
Evidence required: parity test output, refresh dry-run marker report, both-fallback test, vitest summary
Depends on phases: 2, 3
Cleanliness override: converting existing pricing modules that legitimately retain a one-time `console.warn` for unknown models; NO net-new debug prints — reviewer confirms preserved-vs-new.

## Why
Pricing is pure, central to multiple cost surfaces, and the highest tooling-coupling risk: `scripts/refresh-model-pricing.mjs` rewrites `MODEL_PRICING_GENERATED:*` markers in `billing.js`+`pricing.js` by hardcoded path. PARENT-OWNED money/currency.

## Work
- See ROADMAP.md "Phase 4". Authoritative: spec §11 (§11.1 convert, §11.2 shared source, §11.3 preserve parity+history, §11.4 FinOps contracts).
- Convert `app/lib/billing.ts`, `app/lib/claude-code/pricing.ts`, `finops.repository.ts`, the x402-exclusion cost-aggregation in `actions.repository.ts`, code-sessions aggregation. Build ONE shared typed rate-card source that preserves: billing unknown→$0+one-time-warn (ordered substring `includes` match); analytics unknown→Sonnet FALLBACK (exact-key + `[..]`-strip); distinct cache_write/cache_read; custom-org pricing.
- UPDATE `scripts/refresh-model-pricing.mjs` to target the `.ts` files and keep the exact marker strings (`// MODEL_PRICING_GENERATED:BILLING:START/END`, `:PRICING:START/END`). Verify with a DRY-RUN (no `--apply`).
- Port `rate-card-parity.test` to `.ts`; keep it green until a ≥-strength shared-source test replaces it (spec §11.3).
- Preserve `Fleet = AgentLLM(x402_purchase excluded) + x402`; `getClaudeCodeSpend` returns `lens:'claude_code'`. NO historical repricing. DB types `real`/`numeric` unchanged.

## Acceptance criteria (all must pass — verify each in transcript)
- `npm run typecheck` + `npm run lint` clean
- `npx vitest run __tests__/unit/rate-card-parity.test.*` passes (Claude-model parity to 6 decimals)
- `node scripts/refresh-model-pricing.mjs` (DRY-RUN, no --apply) runs clean and reports markers found in BOTH .ts files
- A test proves `estimateCost(_,_,'unknown')===0` AND `priceFor('unknown')===FALLBACK` (both fallbacks preserved)
- A test proves Fleet equation + x402_purchase exclusion + `lens:'claude_code'` response label unchanged
- Full gate (integration boundary): `npx vitest run` green
- No historical repricing; cost_estimate(`real`)/cost_usd(`numeric`) DB types unchanged

## Mandatory commands (run each, surface last ~10 lines + exit code)
- npm run typecheck
- npm run lint
- npx vitest run
- node scripts/refresh-model-pricing.mjs

## Evidence required in transcript
- parity test output; refresh dry-run marker report; both-fallback test; Fleet-equation test; vitest summary

## Notes
PARENT-OWNED. The refresh-script path+marker update is the CRITICAL coupling — verify the dry-run before deleting any `.js` predecessor. Do not change money precision or currency.
