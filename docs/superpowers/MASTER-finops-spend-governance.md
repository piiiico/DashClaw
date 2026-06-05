# MASTER TRACKER — Spend Governance + Unified FinOps

> Cross-session progress anchor for the x402 spend-governance + FinOps initiative. Update this when a phase ships. Last updated: 2026-06-05.

## The vision (locked)

DashClaw becomes the **control plane** for operating an agent fleet — **govern-not-do** intact. Rather than rolling sibling repos in or becoming an agent platform, DashClaw *governs* what agents spend and *aggregates* all cost into one FinOps surface. Two strands, one story:

1. **x402 spend governance** — govern agents' **micropayments** to external capability providers (provider-reported spend; DashClaw never holds a wallet; the agent executes the x402 call, DashClaw records/polices/approves/scores). "Marketplace" = a governed provider registry. "Trust score" = Agent Reputation (separate, already built).
2. **Unified FinOps subsystem** — a read-only **aggregation/presentation layer** (NOT a fusion) that unifies agent LLM cost, x402 micropayments, Code Sessions cost, and CostClaw recoverable-spend under one "Spend" surface. Two lenses: **Fleet** (governed, free) and **Your Claude Code** (FinOps add-on).

Key principle everywhere: **aggregation, not fusion.** Domains stay sovereign; the boundary (`CLAUDE.md`/`PRODUCT.md`) holds.

## Status at a glance

| Item | Status | Commits / refs |
|---|---|---|
| x402 spend governance — **Phase 1 (foundation)** | ✅ SHIPPED to `main` (2026-06-04) | `cd9c658e`..`ffb6c663` (13 commits) |
| Unified FinOps spec + RFC 0002 reconciliation | ✅ committed (2026-06-05) | `e5e1fd87` |
| FinOps **Phase A (foundation + Fleet lens)** | ✅ SHIPPED to `main` (2026-06-05) | plan `3230c5c9`; code `0311635b`..`df4f8a49` (7 commits) |
| FinOps **Phase B** (Claude-Code lens + rate-card parity) | ✅ SHIPPED to `main` (2026-06-05) | spec `64541bf7`; plan `aa8c5bf9`; code `1504a9d6`..`8540f6a2` (5 commits) |
| FinOps **Phase C** (CostClaw recoverable + paid unlock) | ⬜ NOT STARTED — gated on RFC 0002 §8 | — |
| RFC 0002 **Tier 0** (cross-link Code Sessions ↔ costclaw.io) | ⬜ NOT STARTED — independent, ship anytime | — |
| `@claw/engine` + true pricing merge (RFC Tier 1) | ⏸️ DEFERRED to the planned **TypeScript migration** (a parity test guards drift meanwhile) | — |
| x402 Plan 2/3 (operator UI, scoring) | ↪️ SUBSUMED — Plan 2 (x402 dashboard) shipped inside FinOps Phase A; scoring/ranking → FinOps Phase C era | — |

**Current `main` HEAD after this session: `8540f6a2`.** SDK method counts unchanged: **Node 125 / Python 223** (FinOps endpoints are operator-dashboard reads, not SDK methods; `?lens=` added no route path). Unified platform/SDK version: **4.1.1**.

## The reframe (Phase B research, adversarially verified 2026-06-05)

The premise "two rate cards that diverge on price" was **false**. `app/lib/billing.js` and `app/lib/claude-code/pricing.js` are **bit-identical on every shared model** (both regenerated from the same LiteLLM block), and **both stored cost figures already run through `billing.js`** — `action_records.cost_estimate` (4-arg) and `code_sessions.cost_usd` (5-arg cache-aware, re-costed at ingest in `code-sessions.repository.js:125-138`). `pricing.js` is **analytics-only** (rules engine + per-message breakdown; its parser cost is overwritten at persist). So **`billing.js` is canonical for all stored cost**; the cards differ only structurally (coverage: billing.js carries GPT/Gemini/Codex/Llama, pricing.js is Claude-only with a Sonnet fallback; unknown-model fallback $0 vs Sonnet; the intentional A10 0.1×-cache-fold method — do NOT collapse it). The only live hazard is drift, now guarded by a CI parity test. The true single-source merge + `@claw/engine` are deferred to the TS migration.

## What shipped — x402 spend governance (Phase 1)

Foundation for governed paid acquisition. Delivered:
- Migration `drizzle/0021_x402_spend_governance.sql` — 3 tables: `x402_providers`, `x402_endpoints`, `x402_purchases` (keyed 1:1 by `action_id`). Modeled on Agent Registry `0019` (raw SQL, no pgTable; no cross-table FKs by house convention; `--> statement-breakpoint` between statements).
- `app/lib/repositories/x402.repository.js` — provider/endpoint/purchase CRUD (org-scoped, parameterized; inline `slugify`; `ON CONFLICT (action_id)` upsert).
- `app/lib/guard.js` — new `x402_spend_limit` policy_type (blocked/allowed providers → max-spend → approval-threshold → allow). Keys off `context.cost_estimate` + `context.provider`.
- Routes: `app/api/x402/providers[/[id][/endpoints]]/route.js` + `app/api/x402/purchases/route.js` (the governed loop: guard → createAction `x402_purchase` subtype → createPurchase detail). The agent executes the x402 call itself; reports outcome via existing `/api/actions/[id]/outcome`; attaches result via `POST /api/artifacts` (`source_action_id`).
- SDK: 9 Node methods + 8 Python (Node-only `recordPurchaseResult`); docs across all 6 surfaces.

**Design collapse worth remembering:** the March spec's 5 tables → only 3 net-new; `x402_policies`/`x402_approvals` collapsed into the EXISTING `guard_policies` + approvals/outcome routes.

## What shipped — FinOps Phase A (foundation + Fleet lens)

- **Break-out fix:** `getCostAggregation` (`app/lib/repositories/actions.repository.js`) now excludes `action_type='x402_purchase'` → "Agent Spend" = pure LLM cost (was silently including x402, since the purchase route writes `spend_amount` into `cost_estimate`).
- `getX402SpendAggregation` (x402.repository) — x402 spend by day + provider.
- `app/lib/repositories/finops.repository.js` — `getFleetSpend` composes Agent + x402; owns no tables.
- `app/api/finops/spend/route.js` — `GET /api/finops/spend` (Fleet rollup).
- UI: dedicated **Spend** nav group (Sidebar.js); `/spend` overview (Fleet = Agent + x402 + trend); `/spend/x402` purchases table. (Pages are NOT unit-tested in this repo — house pattern; TDD the repo/route, build-verify pages.)

Acceptance: Fleet spend = Agent Spend + x402, the two distinct, summing to the old conflated total.

## What shipped — FinOps Phase B (Claude-Code lens + rate-card parity)

Subagent-driven (5 implementers + 5 adversarial reviewers, all approved; plan adversarially pre-reviewed by 4 skeptics). Delivered:
- `getCodeSessionSpendAggregation` (`code-sessions.repository.js`) — read-only by-day/by-project rollup over stored `code_sessions.cost_usd` (org-scoped, 7d/30d/90d, `created_at` cast-free like the sibling `aggregateCodeSignalsByKind`; pure read, no re-pricing).
- `getClaudeCodeSpend` (`finops.repository.js`) — composes it under `{ lens:'claude_code', period, code_sessions, code_total_usd }`; owns no tables.
- `GET /api/finops/spend?lens=claude-code` — allow-listed lens branch (`fleet` default), same period allow-list, no new route path.
- `/spend/code` page — advisory "Your machine" lens (cards + token-resolved recharts trend + by-project), nav item under the Spend group, **plus a fix to the pre-existing `/spend` active-state over-match** (`if (href === '/spend') return pathname === '/spend'`).
- **Rate-card parity test** (`__tests__/unit/rate-card-parity.test.js`) — probes `billing.js` via `estimateCost` and asserts 4-column agreement with `pricing.js` for all 11 Claude keys + a reverse-coverage guard. Locks the invariant; fails the build on drift.

Gates green: lint, `route-sql:check` (83→83), full `npx vitest run` (**2797 passed / 5 skipped, 0 failures**), `npx next build` (`/spend/code` present). Boundary held: read-only aggregation, no table, no money, advisory `governed:false`.

**Design gotcha worth remembering:** recharts renders `stroke`/`fill`/`stopColor` as SVG **presentation attributes**, where CSS `var()` is NOT reliably honored (would silently render black while the build passes green). The page resolves tokens via `getComputedStyle(document.documentElement)` with token-valued fallbacks — token-driven AND guaranteed to paint. (Every other recharts chart in the repo hardcodes hex for this reason.)

## Artifacts (paths + tracked status)

- `docs/superpowers/specs/2026-06-04-x402-spend-governance-design.md` — x402 spec. **UNTRACKED** (operator chose "write spec, no commit").
- `docs/superpowers/plans/2026-06-04-x402-spend-governance-foundation.md` — x402 Phase 1 plan. **UNTRACKED.**
- `docs/superpowers/specs/2026-06-05-unified-finops-spend-subsystem-design.md` — FinOps spec. ✅ committed.
- `docs/superpowers/plans/2026-06-05-finops-phase-a-fleet-lens.md` — FinOps Phase A plan. ✅ committed.
- `docs/rfcs/0002-costclaw-dashclaw-integration.md` — CostClaw RFC, reconciled against the FinOps spec (§5.3 reframe, §7 correction, §11). ✅ committed. (`0001-generative-ui-governance.md` is UNTRACKED — another session's.)

## Next steps (for the new session)

1. **FinOps Phase C** — CostClaw recoverable-spend preview (`costclaw_recoverable` source) + license-gated `optimize` unlock. **Gated on RFC 0002 §8** billing/entitlement decision (ask before building — touches money).
2. **TypeScript migration** (own milestone) — incremental (`allowJs`, strict-on-new), pure libs first (`billing.js`/`pricing.js`/`url-safety.js`); the single-source pricing merge + `@claw/engine` ride this. The parity test guards drift until then. Operator is "debating" this — spec it when they're ready.
3. **RFC 0002 Tier 0** (cross-link DashClaw Code Sessions ↔ costclaw.io) — independent, ship anytime.
4. Optional hardening from x402 reviews (deferred, consistent with `0019`): no cross-table FKs; no endpoint-level index; `setPurchaseOutcome`/`getEndpoint`/`getPurchase` are pre-declared surface for later phases.

## Things the new session must know (gotchas)

- **Workflow:** commit + push to `main`, no PRs. Gate push on lint + `npx vitest run` + `npx next build` (read output first). Assume deploys go green.
- **Multi-agent hygiene:** the tree has long-standing UNCOMMITTED other-session files (`.impeccable.md` M, `DESIGN.md`, `PRODUCT.md`, `docs/rfcs/0001-*`, + the untracked x402 spec/plan). NEVER `git add -A` — always explicit pathspec. The pre-commit hook auto-regenerates+stages `docs/api-inventory.*`/openapi/livingcode on `app/api`/`app/lib`/`schema`/`middleware`/`livingcode` changes — that's expected and fine.
- **Subagent-driven execution worked well:** fresh implementer per task with exact code in the prompt + the verified house patterns, then a combined (or two-stage for core) review. Adversarially re-check reviewer "criticals" against the actual house pattern (0019) — several were false (cross-entity FKs, INTEGER flags are deliberate).
- **Repository SQL tests:** use a plain `vi.fn()` as `sql` (NOT `createSqlMock` from helpers.js — different shape); assert bound VALUES (`call.slice(1)`), not just the SQL skeleton.
- **`getSql()` is SYNC** (no await). `slugify` is inlined per-repository (no shared export). The DB-side migration runner splits on `--> statement-breakpoint`.
- **Dependabot:** 4 moderate vulns flagged on every push (pre-existing; not from this work).
- **Boundary check for any new work:** does the code spend money or call a provider? → agent-side. Does it record/police/approve/score/aggregate? → DashClaw. FinOps is read-only aggregation; it owns no tables.
