# Spec: Unified FinOps / Spend Subsystem

- Status: Draft (design approved in brainstorming, 2026-06-05)
- Date: 2026-06-05
- Supersedes the standalone framing of: "x402 Plan 2 (operator surfaces)" and RFC 0002 "Tier 2 (in-product preview)" — both are reslotted as phases/sources of this subsystem.
- Relates to: `docs/superpowers/specs/2026-06-04-x402-spend-governance-design.md` (x402, shipped), `docs/rfcs/0002-costclaw-dashclaw-integration.md` (CostClaw), `docs/superpowers/plans/2026-06-04-x402-spend-governance-foundation.md` (x402 Phase 1, shipped)
- Boundary authority: `CLAUDE.md` ("Governance boundary"), `PRODUCT.md` ("Product Purpose")

## 0. Why this document exists

After the x402 spend-governance foundation shipped (2026-06-04), DashClaw surfaces cost in several disconnected places, and a CostClaw integration (RFC 0002) would add another. The operator chose to unify these under one **FinOps subsystem** rather than leave them as parallel tracks. This spec defines that subsystem so that x402 purchase spend, agent LLM cost, Code Sessions cost, and CostClaw "recoverable spend" present as one coherent surface — **without fusing the domains** that produce them.

The non-negotiable framing (the reason this is safe): the subsystem is a **read-only aggregation + presentation layer**. It owns no source data and moves no logic between domains. x402 routes still govern micropayments; the claude-code engine still computes token cost; CostClaw still owns its prescriptive layer and license. The subsystem only normalizes and rolls them up. Govern-not-do is untouched; the developer-setup score never becomes a governance pillar and never touches Agent Reputation.

## 1. Ground-truth: today's fragmented spend surfaces

Verified against source (2026-06-05):

| Surface | File | Shows | Cost source |
|---|---|---|---|
| Agent Spend card | `app/components/AgentSpendCard.js` | 30-day spend, top agents (on Mission Control) | `Σ action_records.cost_estimate` |
| Analytics | `app/analytics/page.jsx` | cost trend + breakdown by agent/action type | `action_records.cost_estimate` |
| Code Sessions | `app/code-sessions/**` | per-project/session Claude Code cost, cache savings, subagent ROI | `code_sessions.cost_usd` (4-column) |
| x402 (Phase 1) | — | none yet | `x402_purchases.spend_amount` |

Two pricing tables exist and can diverge: `app/lib/billing.js` (`estimateCost`/`DEFAULT_PRICING`, the canonical Agent-Spend rate card, LiteLLM-refreshed) and `app/lib/claude-code/pricing.js` (the 4-column Code Sessions rate card, ported from AgentLens). Nav (`app/components/Sidebar.js`) has groups Govern / Observe / Configure / Labs but **no "Spend" section** — cost is scattered.

**Latent bug to fix here:** the x402 route writes `spend_amount` into `action_records.cost_estimate` (`app/api/x402/purchases/route.js`). So x402 micropayments are *already* silently summed into "Agent Spend" alongside LLM token cost, undifferentiated. The aggregation layer must split them by `action_type`.

## 2. Core principle — aggregation, not fusion

The subsystem is a thin read-only layer over distinct, independently-owned spend **sources**. It never owns source data, never writes to a source's tables, and never relocates domain logic. This is the line that delivers one FinOps surface while keeping each domain (x402 governance, Code Sessions, CostClaw) sovereign and the boundary intact.

## 3. The spend-source abstraction

One normalized shape every source maps to, keeping the aggregator source-agnostic:

```
SpendContribution {
  source:   'agent_action' | 'x402_purchase' | 'code_session' | 'costclaw_recoverable'
  lens:     'fleet' | 'claude_code'
  kind:     'actual'        // real cost/spend already incurred
          | 'recoverable'   // advisory waste estimate (CostClaw only)
  governed: boolean         // fleet sources = true; claude_code = advisory/false
  amount_usd: number
  currency:  string         // 'USD' for LLM/Code-Sessions cost; x402 may carry 'USDC' converted to a USD figure for rollup
  period:    { start, end } // or a bucket key (day)
  dims:      { agent_id?, provider_id?, project_id? }
}
```

- **Fleet lens** = `agent_action` (LLM token cost) + `x402_purchase` (capability micropayments). Governed, free, core.
- **Claude-Code lens** = `code_session` (the operator's own Claude Code token cost) + `costclaw_recoverable` (advisory waste). The FinOps add-on; the prescriptive depth is the paid open-core tier.

The abstraction is intentionally small (YAGNI): just enough to aggregate heterogeneous sources by lens / source / period / dimension. No source-specific fields leak into it; per-source detail stays in each source's own pages.

## 4. The aggregation layer

New module `app/lib/finops/` with a thin `finops.repository.js` (or `app/lib/repositories/finops.repository.js` to match the repository convention). Responsibilities:

- **Read from existing repositories only** — `action_records` (via the actions repository; split `action_type = 'x402_purchase'` from the rest), `code_sessions` (via `app/lib/repositories/code-sessions.repository.js`), and the claude-code engine for the recoverable figure. It does **not** issue novel domain writes and owns **no tables**.
- **Return normalized rollups**: totals by lens, by source, by period (daily buckets), and by dimension (agent / provider / project), as `SpendContribution[]` plus pre-summed aggregates for the cards.
- **Org-scoped** on every query (`WHERE org_id = ${orgId}`), reusing the existing repositories' org scoping. **No direct SQL in routes** — the FinOps API route goes through this repository (`route-sql:check`).
- **Pure / side-effect-free** — it computes a view; re-running it changes nothing. This makes it trivially testable with mocked repositories.

API surface (Phase A): `GET /api/finops/spend?lens=&from=&to=` → `{ lenses: { fleet, claude_code }, by_source, by_period, by_dim }`. Backed by `finops.repository.js`.

## 5. UI / Information architecture

A new **"Spend"** nav section (own group, or top of Govern) with a two-lens overview page; each source contributes a panel that links to its own detail page:

```
Spend
├─ Fleet spend             (governed · free)
│   ├─ Agent Spend         ← AgentSpendCard logic, re-homed; LLM token cost only (x402 excluded)
│   └─ x402 Purchases      ← the x402 dashboard: spend by provider, status, value-score; broken out by action_type
└─ Your Claude Code spend  (FinOps add-on)
    ├─ Code Sessions cost  ← existing Code Sessions cost views, cross-linked/re-homed
    └─ Recoverable spend   ← CostClaw preview (advisory, free) + license-gated prescriptive unlock
```

Migration of existing surfaces is **incremental, not big-bang**: the new section first **cross-links** to AgentSpendCard / Analytics-cost / Code-Sessions, then re-homes them over later phases. Uses design tokens from `app/globals.css` (no hardcoded hex; `.impeccable.md` governs). The overview leads with the dollar headline per lens; orange only where attention is required (e.g., an over-budget or blocked-spend signal), consistent with the calm-instrument-panel system.

## 6. Boundary & tiering (unchanged by this subsystem)

- **Fleet lens** = core governance, free to self-host. Governed spend (x402 already runs through `evaluateGuard`; Agent Spend is recorded action cost).
- **Claude-Code lens** = the open-core add-on. The `costclaw_recoverable` headline + waste findings are advisory-free; CostClaw's six-pillar setup score (`scoring.ts` + `rubric.ts`) and `optimize` artifacts stay **license-gated and locally generated** (RFC 0002 §5.3).
- The subsystem is **surface only**. It does not promote the developer-setup score to a governance pillar, does not merge it with Agent Reputation, and does not move any data into a hosted/multi-tenant store (DashClaw is self-hosted; RFC 0002 §2). The `governed` flag on each contribution keeps the two lenses visually and semantically distinct so an operator never reads "your CLAUDE.md hygiene" as "fleet governance."

## 7. Reconciliation with RFC 0002 (CostClaw)

This subsystem **reslots** RFC 0002's tiers rather than replacing them:

- **Tier 0 (cross-link)** — independent; unaffected. Ships whenever.
- **Tier 1 (`@claw/engine` shared package)** — independent enabler; unaffected by x402. This subsystem adds one motivation: reconcile DashClaw's **two** rate cards (`billing.js` for Agent Spend vs `claude-code/pricing.js` for Code Sessions) toward one canonical source so the two lenses agree on model prices. That reconciliation is Phase B here and dovetails with Tier 1 but does not block Phase A. (x402 is unaffected — its spend is provider-reported, not rate-card-derived.)
- **Tier 2 (in-product preview + paid unlock)** — **reframed** as the `costclaw_recoverable` source + the Claude-Code lens of this subsystem (Phase C), instead of a standalone card on the Code Sessions page. Same free/paid line, same local-only privacy promise.
- **§7 correction (factual):** RFC 0002 §7 claims "Tier 1 actively helps x402 by giving one canonical pricing source." That is **wrong** — x402 spend is the agent-reported micropayment amount, not derived from a rate card. Tier 1 helps Agent Spend / Code Sessions pricing, not x402. RFC 0002 is updated to correct this and to point at this spec.

## 8. The x402 break-out fix (correctness, Phase A)

Because `app/api/x402/purchases/route.js` sets `cost_estimate = spend_amount`, x402 micropayments currently inflate "Agent Spend." Phase A's aggregation must compute the Fleet lens as:

- **Agent Spend** = `Σ cost_estimate WHERE action_type <> 'x402_purchase'` (LLM token cost only).
- **x402 Purchases** = `Σ cost_estimate WHERE action_type = 'x402_purchase'` (equivalently `Σ x402_purchases.spend_amount`).

The existing AgentSpendCard should adopt the same `action_type` exclusion so the headline number stops conflating the two. (This is a small, in-scope correction to AgentSpendCard, surfaced by building the subsystem.)

## 9. Phased build

- **Phase A — Foundation + Fleet lens (buildable now, on data that exists today).** The `SpendContribution` abstraction; `finops.repository.js` (read-only aggregation); `GET /api/finops/spend`; the "Spend" nav section + overview shell; the **Fleet lens** (Agent Spend with the x402 break-out fix + the x402 Purchases dashboard). *This subsumes what was "x402 Plan 2."*
- **Phase B — Claude-Code lens (cost) + pricing reconciliation.** Re-home Code Sessions cost into the Claude-Code lens; reconcile `billing.js` ↔ `claude-code/pricing.js` toward one canonical rate card (ties to RFC Tier 1 / `@claw/engine`).
- **Phase C — CostClaw recoverable + paid unlock.** The `costclaw_recoverable` source (advisory preview) + the license-gated prescriptive unlock (RFC 0002 §5.3, §8 billing gate). Gated on the RFC's §8 decision about license/entitlement.

Each phase gets its own implementation plan. Phase A is the only one in scope for the immediate next plan.

## 10. Non-goals

- No fusion of the x402 governance subsystem and the CostClaw FinOps add-on; the aggregation layer is the only shared surface.
- No tables owned by the FinOps subsystem; it is read-only aggregation over existing stores.
- No promotion of the developer-setup score to a governance pillar; no merge with Agent Reputation.
- No hosted/multi-tenant store; no piping CostClaw local data anywhere (self-hosted only).
- No payment/wallet/provider-execution added (x402 boundary preserved); CostClaw billing stays Lemon Squeezy in the operator's own instance.
- No big-bang reorg of existing cost pages — cross-link first, re-home incrementally.

## 11. Open questions (for the plan stage)

- Exact `finops.repository.js` home (`app/lib/finops/` vs `app/lib/repositories/`) and whether the recoverable figure is computed inline or behind the future `@claw/engine`.
- Currency handling for x402 when `currency = 'USDC'` — store a USD-equivalent figure for rollup, or display native + a converted total? (Phase A can assume 1 USDC ≈ 1 USD and revisit.)
- Whether the "Spend" section is its own nav group or nested under Govern (Observe is cost-adjacent via Code Sessions).
- Phase B rate-card reconciliation: does `billing.js` adopt `@claw/engine`, or do they stay separate with a parity test? (Decide with RFC Tier 1.)

## 12. Verification approach

- Phase A unit tests: `finops.repository.js` with mocked source repositories (assert lens/source split, the `action_type` x402 break-out, org-scoping, daily bucketing); the `/api/finops/spend` route via the established `vi.hoisted`/`vi.mock` pattern; AgentSpendCard's x402 exclusion.
- Gates: full `npx vitest run`, `npm run lint`, `npx next build` (the Spend pages are under `app/**`), `route-sql:check` (FinOps route → repository).
- Acceptance signal: the Fleet-lens overview shows Agent Spend and x402 Purchases as **distinct** numbers that sum to the old (conflated) Agent Spend total, proving the break-out is correct.

## 13. Next step

Transition to `writing-plans` for **Phase A** when the operator is ready. Phases B and C get their own plans later (B after/with RFC Tier 1; C after the RFC §8 billing-gate decision).
