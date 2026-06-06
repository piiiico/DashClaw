# THINKING — DashClaw JS→strict-TS migration

Authoritative spec: `docs/plans/typescript-migration.md` (1300 lines). This file is parent synthesis, NOT a replacement. Roadmap/phase specs reference the spec's section numbers rather than duplicating it.

## Goals (measurable end-state — from spec §24 Completion Criteria)

Production app is TS/TSX (documented exceptions aside); `npm run typecheck` 0 errors; lint clean; full `npx vitest run` green; `npx next build` green; docs/contracts/openapi/api-inventory/route-sql/version-sync checks green; sdk:integration (node+python) green; no duplicate JS+TS implementations; no unexplained suppressions; security-critical inputs runtime-validated; identity/risk/tenancy/audit/x402/FinOps/pricing invariants preserved and tested.

## Hard constraints (spec §4 + user message — non-negotiable)

1. **Governance boundary** — DashClaw governs/records/approves/blocks/scores/aggregates x402; never executes payments, never holds wallet credentials.
2. **FinOps accounting** — Fleet Spend = Agent LLM Spend + x402 Purchase Spend; Agent LLM Spend EXCLUDES `x402_purchase` (enforced in `actions.repository.js:1037/1049/1063`); Claude Code spend advisory + separately modeled; **stored costs never repriced during aggregation**.
3. **Pricing** — `billing.js` authoritative (unknown→$0+warn, ordered substring match); `pricing.js` analytics (unknown→Sonnet FALLBACK, exact-key+`[..]`-strip); preserve BOTH fallback semantics; keep `rate-card-parity.test.js` green until a shared source replaces the duplicate cards with ≥-strength tests; preserve custom org pricing + cache rates + GENERATED-marker refresh.
4. **Identity** — verified JWT `sub` overrides self-asserted body (`resolveAgentIdentity`); all action-creating routes (`/api/guard`, `/api/actions`, `/api/x402/purchases`, integration routes) converge on one typed identity contract; self-asserted never confused with verified.
5. **Risk** — server-computed risk authoritative; client risk can only RAISE never lower (`guard.js:223` `max(server, agentReported)`); same value flows to guard_decisions, action_records, x402 actions, alerts, analytics, responses, UI. Integer 0–100.
6. **Audit durability** — `guard_decisions` INSERT is awaited + fail-loud (`GUARD_AUDIT_PERSIST_FAILED`); no success response before audit evidence durably persisted.
7. **Tenant isolation** — every tenant-owned query scoped by `org_id`; org context never optional in security-critical services/repos (`evaluateGuard` throws on missing orgId).
8. **Money safety** — values finite + nonnegative; currency explicit; NO silent change to DB precision / API representation / rounding / units; no integer-cents conversion without approved compatibility design; USDC/micropayments may need fractional precision.
9. **Runtime validation NOT replaced by TS types** — Zod (v4 present) / schema layer stays at every external boundary; TS types inferred from schemas, not substituted for them.
10. **Don't weaken** security, tenant isolation, payment governance, audit durability, tests, or build checks to make the migration pass. Preserve current behavior unless fixing a CONFIRMED defect.
11. **No-commit run** — no commit/push/deploy/publish/release/infra/money-precision/currency/repricing/incompatible-API/DB-semantics change without explicit approval (spec §22, user message).

## Out of scope (spec §3 Non-Goals)

No framework/db rewrite; no payment processor/wallet; no domain fusion; no historical repricing; no CostClaw paid unlock; **Python SDK NOT converted**; shell scripts NOT converted; no migration deletion; no feature creep.

## Risks (top, ranked)

1. **Scale (CRITICAL/likely).** ~1076 `.js` + 169 `.jsx`, ~zero existing TS. A full strict conversion of 1200+ files in one autonomous run is enormous; risk of partial completion / type-error avalanche under `strict` + `noUncheckedIndexedAccess`. *Mitigation:* `allowJs:true` coexistence so the repo stays green throughout; convert by dependency-ordered domain packets, each independently verified; foundation enables `typecheck` early; the run is INCREMENTAL — a packet that doesn't finish leaves a buildable repo, not a broken one. Audit-coverage limits surfaced up front (item 9).
2. **Pricing/refresh tooling break (HIGH/likely).** `scripts/refresh-model-pricing.mjs` rewrites `MODEL_PRICING_GENERATED:*` markers inside `app/lib/billing.js` AND `app/lib/claude-code/pricing.js` by path+marker. Converting those to `.ts` breaks the refresh script and `pricing:refresh` unless updated in lockstep. *Mitigation:* Phase 5 owns billing/pricing AND the refresh script together (parent-owned money contract); preserve markers in the `.ts` files; add/keep parity coverage.
3. **Silent invariant erosion (HIGH/medium).** A "shared pricing source" or typed risk/identity refactor could quietly flip unknown→$0 to unknown→Sonnet, drop the x402 exclusion, or let client risk lower server risk — all of which still typecheck and may pass coarse tests. *Mitigation:* parent owns shared pricing/identity/money/risk contracts; dedicated adversarial reviewers (pricing, FinOps, x402, identity, risk) cite file+line; explicit tests per intentional difference; behavior-preservation over type-purity.
4. **DB-semantics class the mocked suite can't catch (HIGH/medium).** Typed row mappers + JSON-column parsing can change null-handling / numeric-string coercion / ON-CONFLICT inference; the mocked Vitest suite passed these before and won't catch a regression. *Mitigation:* model nullable columns + pg-numeric-as-string explicitly; no DB-semantics change without approval; DB-consistency reviewer; keep parameterized SQL + org_id filters byte-for-byte.
5. **Tooling/extension fallout (MEDIUM).** route-sql baseline, openapi, api-inventory, livingcode, version injection (`next.config.js` → `NEXT_PUBLIC_DASHCLAW_VERSION`), eslint-config-next all assume `.js`. *Mitigation:* tooling lane verifies each generator/checker tolerates `.ts/.tsx`; foundation phase wires eslint TS parser; run the generated-artifact checks after route/UI packets.

## Dependencies (migration order — spec §6–§20)

Foundation (tsconfig+typecheck+eslint-TS, allowJs) → Domain types (identity, governance, actions, pricing/finops, x402, db) → Runtime schema alignment (Zod at boundaries) → Pricing+FinOps (early: pure, central) → Security core (identity/JWT/replay/binding/risk/guard/audit) → x402 repo+routes → DB repositories (grouped) → API routes (grouped) → UI/TSX → Integrations+Node-SDK+scripts → Tests → Unsafe-typing audit → Adversarial review → Final audit. Parent owns shared types, schemas, identity contract, pricing/money/currency architecture, final integration + verification.

## Open questions (assumed; correct at plan review)

- Branch: spec recommends `refactor/typescript-migration`; repo on `main`, clean. Since run is no-commit, default = create the isolated branch in Phase 0 (safe local op, no commit) so the working tree lives on it. (Surfacing as a question.)
- Scope realism: default to "drive as far as the autonomous run safely can with each packet verified," not "guarantee 100% of 1200 files in one run." Honest audit-coverage limits stated.
- Smoke/test:api: preexisting-failing on this host; verification matrix treats them as preexisting, not migration gates.

## Memory hits applied

See `applied-memories.md`. Load-bearing: FinOps/x402 invariants, cost-snapshot/no-reprice, billing-vs-pricing dual semantics, pg-numeric-string, route-SQL guard, unified-SDK-version, no-commit + repo-state audit, full-suite verification, evidence-based adversarial review.

## Tools / skills relied on

See `tools.md`. Context7 for Next16/TS/Zod docs; Workflow for parallel conversion + adversarial review; `dashclaw-ship` for the docs/version sweep; `impeccable`/`frontend-verify` for the `/spend/code` brand-orange visual check.

## Best practices applied

Incremental TS adoption with `allowJs` coexistence; schema-inferred types at boundaries; discriminated unions for guard decisions/policies + x402/action status; branded id types (OrganizationId/AgentId/ActionId…) to prevent cross-wiring; treat DB rows as untrusted until mapped; verify each packet before deleting its JS predecessor; no broad suppressions; parent-owned shared contracts; non-overlapping write ownership for parallel agents.
