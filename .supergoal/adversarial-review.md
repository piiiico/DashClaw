# Phase 13 — Parallel Adversarial Review (spec §20)

15 independent read-only reviewers each attempted to **disprove** that the JS→TS migration is complete/correct for their dimension, citing severity + file + quoted evidence + failure scenario + fix + verification. Parent verified every finding against the actual code (trust-only-what-you-read), rejected unsupported claims, and fixed every confirmed CRITICAL/HIGH.

## Per-dimension verdicts

| # | Dimension | Verdict | Findings |
|---|---|---|---|
| 1 | Type correctness | **FINDINGS** | 1 HIGH + 1 MEDIUM — `::real` driver-string coercion (FIXED) |
| 2 | Runtime validation | PASS | — |
| 3 | Identity & authorization | PASS | — |
| 4 | Tenant isolation | PASS | — |
| 5 | Guard & risk correctness | PASS | — |
| 6 | Audit durability | PASS | 1 LOW (error-code granularity; preexisting) |
| 7 | Database consistency | PASS | 1 LOW (same coercion root cause as d01 — FIXED) |
| 8 | Pricing correctness | PASS | — |
| 9 | FinOps accounting | PASS | — |
| 10 | x402 governance & payment boundary | PASS | — |
| 11 | API compatibility | PASS | 1 LOW (inventory detector gap; preexisting) |
| 12 | React correctness | PASS | — |
| 13 | Test quality | PASS | — |
| 14 | Build & deployment | PASS | — |
| 15 | Dead code & duplicate impls | PASS | 1 LOW (documented-exception .js; not incomplete) |

**14 of 15 dimensions PASS. 0 CRITICAL. 1 HIGH + 1 MEDIUM (same root cause) — both FIXED + regression-tested.**

## CONFIRMED + FIXED

### HIGH (d01) — `::real` aggregates return as STRINGS → `fleet_total_usd` concatenates to NaN → Fleet KPI renders $0.00
- **Evidence (verified):** `x402.repository.ts:251` returned `total_spend_usd: (totals?.total_spend_usd as number) ?? 0` over a `COALESCE(SUM(spend_amount),0)::real` aggregate. The Neon/postgres drivers return `::real` as a **string** (db.js registers no type parser — bare `neon(url)`/`postgres(url)`); the codebase's own `actions.repository.ts:1338` `Number(totals?.total_cost_usd ?? 0)` and `analytics.repository.ts` (`as string` + `parseFloat`) confirm this. `finops.repository.ts:24` then did `(agent.total_cost_usd /*number*/) + (x402.total_spend_usd /*string*/)` → `"5.51.25"` → `Number(...)` = NaN → `/spend` headline `$0.00`.
- **Severity rationale:** violates completion criterion **§24.25** (Fleet Spend = Agent LLM + x402). The breakdown tiles + the by_day chart were SAFE (the UI re-coerces via `fmt`/`Number()`); only the server-computed `fleet_total_usd` was broken.
- **Preexisting vs migration:** PREEXISTING — baseline `x402.repository.js` had `total_spend_usd: totals?.total_spend_usd ?? 0` (no coercion). The migration's `as number` cast merely *hid* the string-vs-number mismatch from the type system. Fixing it is required to satisfy §24.25 (a completion criterion).
- **Fix:** `Number()` coercion at the repo boundary (`x402.repository.ts`, `code-sessions.repository.ts`) matching `actions.repository.ts`, plus defense-in-depth `Number()` at the invariant site `finops.repository.ts:24,43`. `Number()` is correct whether the driver yields a string or a number.
- **Verification:** new regression tests in `__tests__/unit/s18-identity-finops.regression.test.ts` mock the sql tag to return the driver's **string** `total_spend_usd: '1.25'` and assert `getX402SpendAggregation().total_spend_usd === 1.25` (number) and `getFleetSpend().fleet_total_usd ≈ 6.75` (not `"5.51.25"`/NaN). Both fail pre-fix. Full gate green (typecheck 0, lint 0, vitest 2910/0).

### MEDIUM (d01) — same `as number` lie on `getCodeSessionSpendAggregation` `::real` fields
- Fixed in the same change (`code-sessions.repository.ts:834-836` → `Number()`); `finops.repository.ts:43` `code_total_usd` hardened. Restores the `ClaudeCodeSpend.code_total_usd: number` contract.

## ACCEPTED / NOT-A-MIGRATION-DEFECT (LOW)

- **d06 LOW — `GUARD_AUDIT_PERSIST_FAILED` returns generic 500 instead of 503 `SCHEMA_NOT_INITIALIZED` when `guard_decisions` is missing.** Audit DURABILITY (the invariant) is intact — the INSERT is awaited and fails loud. This is an error-code-granularity nicety on a preexisting path (not changed by the migration). Deferred (cosmetic; out of migration scope).
- **d11 LOW — `api-route-inventory.mjs` method-detector skips the `export { handler as GET }` object form used by `/api/auth/[...nextauth]`.** Reviewer confirms PREEXISTING (the detector predates the migration; the route's surface is unchanged). The inventory/openapi contracts still pass. Deferred.
- **d15 LOW — `app/landingData.js`, `app/demo/page.js`, `app/pair/...` remain `.js`.** Verified NOT incomplete UI: `landingData.js` = pure data (0 JSX, imported by `page.tsx`); `demo/page.js` = 11-line non-JSX redirect/stub (0 JSX); `app/pair/[pairingId]/page.tsx` is already `.tsx`. These are documented `.js` exceptions (`.supergoal/exceptions-report.md`), not duplicates or dead code. No duplicate `.js`+`.ts` module exists anywhere (verified).

## Acceptance criteria — status
1. All 15 dimensions reviewed; this doc records per-dimension verdict + evidence — ✅
2. Every confirmed CRITICAL/HIGH fixed + re-verified — ✅ (1 HIGH + the same-cause MEDIUM/LOW fixed; regression-tested)
3. No duplicate JS+TS implementation remains — ✅ (extension cross-grep clean)
4. typecheck + lint clean AND vitest green after fixes — ✅ (typecheck 0, lint 0, vitest 2910/0)
