# Spec: FinOps Phase B — "Your Claude Code" Spend Lens + Rate-Card Parity

- Status: Draft (design approved in brainstorming, 2026-06-05)
- Date: 2026-06-05
- Parent: `docs/superpowers/specs/2026-06-05-unified-finops-spend-subsystem-design.md` (§9 Phase B; resolves the §11 rate-card open question)
- Relates to: `docs/rfcs/0002-costclaw-dashclaw-integration.md` (Tier 1, now deferred to the TS migration)
- Boundary authority: `CLAUDE.md` ("Governance boundary"), `PRODUCT.md` ("Product Purpose")

## 0. Why this document exists

Phase A shipped the **Fleet lens**. Phase B adds the second lens — the operator's own Claude Code token spend — and closes the "reconcile the two rate cards" item the subsystem spec (§9, §11) left open. A read-only research pass (2026-06-05, every top claim adversarially verified) overturned the premise that the two cards diverge on price. This spec records the corrected ground truth and scopes Phase B to what is actually left.

## 1. Corrected ground truth (the reframe)

The subsystem spec §1 said "two pricing tables exist and can diverge." Verified against source, that framing is misleading:

- **`billing.js` and `claude-code/pricing.js` are bit-identical on every shared model.** Both are regenerated from the same LiteLLM block by `npm run pricing:refresh`. `opus-4-8` = 5/25/6.25/0.50, `opus-4-1` = 15/75/18.75/1.50, `sonnet-4-6`/`4-5` = 3/15/3.75/0.30, `haiku-4-5` = 1/5/1.25/0.10 — identical in both files, same per-MTok unit.
- **Both stored cost figures already run through `billing.js`.** Agent Spend (`action_records.cost_estimate`) uses `billing.js`'s 4-arg `estimateCost`; persisted `code_sessions.cost_usd` is re-costed through `billing.js`'s 5-arg cache-aware path at ingest (`app/lib/repositories/code-sessions.repository.js:125-138`, and `appendLiveTurn` :288-295). `pricing.js`'s `costForUsage` only sets the parser's *in-memory* `parsed.cost_usd`, which is overwritten at persist.
- **`pricing.js` is analytics-only.** Its real consumers are the Code Sessions rules engine (`model-downshift`, `bad-cache-hit`, `cache-write-bloat`, `subagent-prompt-bloat`), the `model-tier` classifier, and the per-message cost breakdown — not the stored cost column.

So **`billing.js` is the canonical card for all stored cost.** The two cards differ *structurally*, not numerically:

- **Coverage:** `billing.js` prices 26 models incl. GPT/o-series/Gemini/Codex/Llama + family defaults; `pricing.js` is Claude-only (11 keys) with a Sonnet-shaped `FALLBACK`.
- **Matching + unknown-model fallback:** `billing.js` does case-insensitive substring matching and returns **$0** for unknown models (refuses to guess); `pricing.js` does exact-key lookup (after stripping a trailing `[…]` alias) and returns **Sonnet rates** for unknown.
- **Costing method:** `billing.js`'s 4-arg path folds `cache_read` into `tokens_in` at 0.1× (the documented **A10** spread; load-bearing for the bit-identical Agent-Spend regression gate); `pricing.js` prices cache columns separately. **This method difference is intentional and must not be collapsed.**

The one live hazard is **drift**: a model/alias added to `billing.js` silently falls back to Sonnet in `pricing.js`-driven analytics, and the two cards' unknown-model contracts already disagree ($0 vs Sonnet).

## 2. Scope

Phase B = two deliverables. Both are read-only; neither touches money nor adds a table.

1. **"Your Claude Code" spend lens** — re-home Code Sessions cost into the FinOps "Spend" section as a second, **advisory** lens beside Fleet.
2. **Rate-card parity test** — a CI test that locks `billing.js` ↔ `pricing.js` agreement and fails the build on drift.

**Out of scope (deferred):**

- The single-source pricing **merge** and the `@claw/engine` extraction → the planned **TypeScript migration era** (resolves subsystem spec §11; see §6). Doing the merge in JS now would be thrown away in the migration.
- `costclaw_recoverable`, the six-pillar setup score, `optimize` artifacts, any license/entitlement → **Phase C**, behind RFC 0002 §8 (the money gate).
- **x402** → excluded from reconciliation entirely (its spend is provider-reported, not rate-card-derived — the withdrawn RFC §7 claim).

## 3. Part 1 — the Claude-Code lens

Clone the **shipped** Phase-A pattern (a flat per-lens object), not the subsystem spec's idealized `SpendContribution[]` / `lenses`-wrapper / `from`–`to` contract, which never shipped. Mirroring the shipped shape keeps the two lenses structurally consistent.

### 3.1 Repository aggregation (`code-sessions.repository.js`)

Add a read-only by-day rollup over stored `cost_usd` — none exists today; the repository has only a by-project `SUM(cost_usd)` and a token-only time-range aggregator. Org-scoped, period-bounded, **no direct SQL in routes** (this lives in the repository).

```
getCodeSessionSpendAggregation(sql, orgId, { period = '30d' }) ->
  {
    period,
    total_cost_usd,            // Σ cost_usd over the window
    total_cache_savings_usd,   // Σ cache_savings_usd
    session_count,
    by_day:     [ { date, cost_usd, session_count } ],
    by_project: [ { project_id, project_name, cost_usd, session_count } ]
  }
```

- Same `7d`/`30d`/`90d` period map as the x402 aggregator (`X402_PERIOD_DAYS` analog) — do not silently accept other values.
- Numeric columns cast `::real` / `::integer` (Neon returns `numeric` as a string — the pg-numeric reducer trap).
- **Pure read of already-stored cost; no re-pricing.** (Both Agent Spend and Code Sessions cost already use `billing.js`, so there is nothing to reconcile at read time.)

### 3.2 FinOps composition (`finops.repository.js`)

```
getClaudeCodeSpend(sql, orgId, { period = '30d' }) ->
  {
    lens: 'claude_code',
    period,
    code_sessions: <getCodeSessionSpendAggregation result>,
    code_total_usd: code_sessions?.total_cost_usd ?? 0
  }
```

Composes via the existing code-sessions repository; **owns no tables**; mirrors `getFleetSpend`'s defensive `?? 0`. The JSON `lens` tag is `claude_code` (snake, matching the spec's enum and `getFleetSpend`'s `'fleet'`); the URL slug is `claude-code` (hyphen).

### 3.3 Route (`app/api/finops/spend/route.js`)

Add a `?lens=` branch to the existing endpoint (keeps one FinOps route):

- `ALLOWED_LENSES = new Set(['fleet','claude-code'])`, default `'fleet'`.
- Same `ALLOWED_PERIODS` (`7d`/`30d`/`90d`, default `30d`).
- `fleet` → `getFleetSpend`; `claude-code` → `getClaudeCodeSpend`.

No new route path (no SDK/api-inventory route-count change; FinOps endpoints are operator-dashboard reads, not SDK methods).

### 3.4 UI (`/spend/code` page + nav)

- New `app/spend/code/page.jsx` mirroring `app/spend/page.jsx` (period toggle, summary cards, recharts `AreaChart` built from `by_day`) — **but using CSS design tokens, never hardcoded hex.** The current `/spend` page hardcodes `#f97316`/`#808088`/`#1a1a1a` (an `.impeccable.md` violation); the new page must read tokens from `app/globals.css` / the Tailwind theme. Read `.impeccable.md` before building this page.
- Labeled **advisory** and visually distinct ("Your machine · advisory") so an operator never reads their own CLI cost as fleet governance — the `governed: false` semantics from the subsystem spec, surfaced as a label. `PageLayout maturity='beta'`.
- **Cross-links** to the existing `/code-sessions` detail pages (incremental re-home: aggregate + cross-link; do **not** retire the source pages — subsystem spec §5/§10).
- Nav: add an item under the existing **Spend** group in `app/components/Sidebar.js`; add the `startsWith` guard so `/spend/code` does not also highlight the `/spend` Overview item (the same special-case the sidebar already applies to `/agents` vs `/agents/registry`).

### 3.5 Tests

- New `code-sessions` aggregation test: plain `vi.fn()` as `sql` asserting the **bound values** (period→days, org scoping), not just the SQL skeleton — and that totals/by_day/by_project shapes are returned.
- New `getClaudeCodeSpend` test mirroring `finops-repository.test.js` (mock the source repo; assert `lens:'claude_code'`, passthrough, `code_total_usd`).
- Route test mirroring `finops-spend.route.test.js`: `?lens=claude-code` dispatches to `getClaudeCodeSpend`; default/invalid lens → `fleet`; default/invalid period → `30d`.
- Pages are **build-verified** (not unit-tested) per the house pattern.

## 4. Part 2 — rate-card parity test

A pure test (no runtime change) that locks the invariant the reframe revealed:

- For every model id **both** `billing.js` and `pricing.js` define: assert `input`/`output`/`cache_write`/`cache_read` are equal.
- For every Claude model/alias `billing.js` knows: assert `pricing.js` prices it within ε of `billing.js` (catches the silent-Sonnet-fallback drift before it ships).
- Header comment documents the canonical/analytics split: `billing.js` is authoritative for stored cost; `pricing.js` is analytics-only.

This satisfies subsystem spec §11 option (b) ("stay separate with a parity test") and becomes the safety net guarding the eventual TS-era merge.

## 5. Boundary check

- Read-only aggregation of already-stored cost. **No provider call, no money movement, no new table, no source-table write.** `govern-not-do` intact; the FinOps layer still owns no tables.
- The Claude-Code lens is **advisory** (`governed:false`) and labeled so — semantically distinct from governed Fleet spend.
- Phase C surfaces (recoverable / score / optimize / license) are explicitly **not** in this plan; the §8 money gate is never approached.

## 6. Resolution of subsystem spec §11 (the rate-card open question)

Subsystem spec §11 asked: *"does `billing.js` adopt `@claw/engine`, or do they stay separate with a parity test? (Decide with RFC Tier 1.)"*

**Resolved (2026-06-05):** **Stay separate with a parity test now.** The true single-source merge — unifying `billing.js` + `pricing.js` into one canonical pricing module — happens during the planned **TypeScript migration**, where that module is the natural content of a TS-native `@claw/engine`. Rationale: (a) the two cards are already numerically reconciled (same LiteLLM block), so a JS merge now buys little; (b) the merge must reconcile two divergent *contracts* ($0-vs-Sonnet fallback, `cache_creation_tokens` vs `cache_creation_input_tokens` field names) — exactly the class of change TS makes safe; (c) RFC 0002 Tier 1's stated enabler is itself factually wrong (it claims CostClaw "bundles via tsup"; CostClaw builds with `tsc`, and DashClaw has no `tsconfig`), so the extraction is not the "pure win, do now" the RFC framed. `@claw/engine` and the merge are therefore both deferred to the TS era; the parity test is the bridge.

## 7. Verification

- Full `npx vitest run`, `npm run lint`, `npx next build` (Spend pages under `app/**`), `route-sql:check` (FinOps route → repository).
- Acceptance: `/spend/code` shows the operator's Claude Code cost (total + by-day trend + by-project) sourced purely from stored `code_sessions.cost_usd`, and its total matches the existing `/code-sessions` index total; the parity test fails the build if the two cards drift.

## 8. Next step

Transition to `writing-plans` for Phase B. Phase C remains gated on RFC 0002 §8.
