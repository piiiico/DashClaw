# Spec: x402 Spend Governance — the Control-Plane Pillar

- Status: Draft (design approved in brainstorming, 2026-06-04; not yet committed)
- Date: 2026-06-04
- Supersedes/refines: `docs/planning/dashclaw-x402-capability-acquisition-spec.md` (March 2026) and `docs/planning/DashClaw x402 Strategy Doc.txt`
- Relates to: `docs/rfcs/0001-generative-ui-governance.md` (which deferred x402 to "Phase 6, behind its own RFC" — this is that RFC's seed)
- Boundary authority: `CLAUDE.md` ("Governance boundary"), `PRODUCT.md` ("Product Purpose")

## 0. Why this document exists

The operator asked whether to roll the `budget-aware-research-agent` repo into DashClaw and add x402, agentic wallets, payments, a marketplace, and a trust score — so that "DashClaw is the only thing I ever need to operate my fleet."

Through brainstorming, four decisions were locked:

1. **DashClaw becomes a complete _control plane_, not an agent platform.** It is the one place to see, govern, audit, and pay-for a fleet whose agents still live in their own repos. This preserves the governance boundary verbatim: *DashClaw governs goals; it does not give agents tools to achieve them.*
2. **"Marketplace" means a _governed provider registry_** — a curated catalog of paid x402 capabilities the fleet's agents acquire from (the spec's §5.5), not a two-sided transacting marketplace and not a wallet product.
3. **"Trust score" is already being built** as Agent Reputation (a separate, concurrent work stream). This pillar _connects to_ reputation; it does not rebuild it.
4. **Build scope is the full capability-acquisition spec** (§5–§7 of the March doc) — **with one correction** (see §2): the x402 _executor and provider adapters stay agent-side_, never inside DashClaw.

The net effect: x402 + wallets + payments + marketplace collapse into a single initiative — the **spend-governance pillar** of the control plane — and the research agent becomes its **first governed consumer**, with zero of its code moving into DashClaw.

## 1. Boundary map (the load-bearing section)

Every component is assigned to exactly one side of the boundary. The test for any future PR: *does this code spend money or call a provider?* If yes → agent-side. If it records, polices, approves, or scores → DashClaw.

| Concern | Lives in | Rationale |
|---|---|---|
| Wallet, USDC funding, x402 settlement | **agentcash** (external) | DashClaw never holds keys or money |
| Provider adapters (Exa, Firecrawl, Apollo, Grok, StableUpload…), the actual fetch | **Agent-side** (the consuming agent / a thin shared client) | The agent *does*; DashClaw *governs* |
| Provider registry (catalog, pricing, sensitivity, allow/block, value scores) | **DashClaw** | Governance metadata, not execution |
| Pre-spend policy (max-spend per call/task/agent/day, category rules, approval threshold) | **DashClaw** | Extends the existing policy engine |
| Purchase records (what / why / how-much / result / worth-it) | **DashClaw** | The moat: legible, auditable spend |
| Approval queue for gated spend | **DashClaw** | Reuses the existing `waitForApproval` loop |
| Spend dashboard + cost-to-value scoring | **DashClaw** | Operator surface |

## 2. The correction to the March spec (non-negotiable)

The March `dashclaw-x402-capability-acquisition-spec.md` predates the hardened governance boundary, and **§7.4 (x402 Execution Service) and §7.5 (Provider Adapter Layer)** place the executor and per-provider adapters _inside DashClaw_. Under the control-plane decision that is a boundary violation: it makes DashClaw the thing that calls providers and spends money.

**Revision:** §7.4 and §7.5 are removed from DashClaw's scope. The executor and adapters live agent-side. DashClaw exposes:

- the **registry** the agent reads to choose a provider,
- the **policy preflight** the agent calls before spending,
- the **record/approval/outcome** surface the agent writes to after spending.

A thin shared x402 client (the adapter layer) MAY be published as a separate package the operator's agents import, but it is not part of the DashClaw runtime.

## 3. Data model

Reuse before adding. The spec's five tables (`x402_providers`, `x402_endpoints`, `x402_purchases`, `x402_policies`, `x402_approvals`) are built, **but**:

- **`x402_purchases` is a specialization of the existing `action_records` table** (note: the table is `action_records`, not `actions`), linked by `action_id` — not a parallel ledger. A purchase is a governed action subtype (`action_type: 'x402_purchase'`), so it flows through the **existing** decision timeline, evidence-bundle assembly, and outcome-finality machinery already shipped (`drizzle/0004_action_outcome_finality.sql`). The x402-specific columns (provider/endpoint/spend/rationale/value-score) hang off the action either as additional columns or a joined `x402_purchases` detail row keyed by `action_id`; pick one in the plan, do not duplicate the action lifecycle.
- **`x402_policies` extends the existing policy engine**, not a fork. The pre-spend check is a new policy *type* evaluated by the same deterministic evaluator that backs guard/approval today.
- **`x402_providers` / `x402_endpoints`** are the governed provider registry (the "marketplace"). Reconcile their shape against whatever the concurrent **Agent Registry** work lands, so the two registries share conventions (id prefixes, org scoping, repository pattern) rather than diverging.
- All access goes through repositories (`app/lib/repositories/*.repository.js`); **no direct SQL in route files** (`route-sql:check` gate).
- After any schema change: `npm run db:migrate` locally (per the documented 401-on-stale-schema trap).

## 4. The governed acquisition loop

No new primitive — this is the SDK loop the RFC already pinned, applied to spend:

1. `guard({ action_type: 'x402_purchase', declared_goal, risk_score, provider, endpoint, estimated_cost })` — advisory pre-check.
2. `createAction({ action_type: 'x402_purchase', spend fields, rationale fields })` → returns `{ action, action_id }`. **Branch on `action.status`, not on the guard decision** — the server is authoritative and may set `pending_approval` even when guard returned `allow`.
3. If `pending_approval`: `waitForApproval(action_id, …)` — called with the `act_` action id, never the `act_gd_` decision id.
4. **The agent executes the x402 call** (agent-side, via agentcash). DashClaw is not in this step.
5. `updateOutcome(action_id, { status, cost, value_score, … })` (or one-shot `reportActionOutcome`) records finality once.
6. The result snapshot is written as an **artifact** via `POST /api/artifacts` with `source_action_id` set to the purchase action — so it appears in that action's evidence bundle with no extra wiring. Do **not** use `guard_decisions.evidence` (scoped to non-fabrication receipts).

Required record fields (from spec §5.2): provider, endpoint, category, spend_amount, currency, payment_method, wallet_reference, purchase_reason, context_gap, alternatives_considered, expected_value, approval_status/actor, execution_status, result_summary, result_reference, value_score, confidence_score, timings, failure_reason. **Paid actions cannot be recorded without the rationale fields** — that constraint is the difference between this and a hidden API call in a black box.

## 5. Surfaces (spec §6, on the existing design system)

All reuse the dark/orange instrument-panel system (`.impeccable.md`, `DESIGN.md`, tokens in `app/globals.css`) and existing approval/timeline components. Never hardcode hex.

- **Decision timeline:** a "Paid Capability" action card (provider chip, spend chip, approval-state chip, result status, one-line rationale). Orange only where attention is required.
- **x402 detail drawer:** Overview / Why-purchased / Policy-evaluation / Result / Outcome-assessment / Linked-artifacts.
- **Spend dashboard:** summary cards, spend-by-provider, spend-by-workflow, value analysis (cost per useful artifact, justified vs unjustified), exceptions (blocked, outliers, repeated low-value).
- **Provider registry view:** searchable catalog, provider detail, governance panel (allow/block, max-spend overrides, category restrictions, approval threshold).
- **Approval queue:** gated-spend items with approve-once / approve-for-task / deny / adjust-ceiling / add-rule.

## 6. SDK surface + the documentation tax

New methods land in **both** Node (`camelCase`) and Python (`snake_case`) at parity: provider/registry reads (`listProviders`, `getProvider`), the purchase fields on `createAction` (or a dedicated `recordPurchase`), value scoring (`scorePurchaseValue`), and policy CRUD for the x402 policy type.

This triggers the **full SDK documentation checklist** — every one of these must be updated together:

1. `app/docs/page.js` (website docs)
2. `sdk/README.md` (Node — serves the "Copy as Markdown" button via `/api/docs/raw`)
3. `sdk-python/README.md` (Python)
4. `docs/sdk-parity.md` (parity matrix + method counts)
5. `docs/api-inventory.md` (route inventory — auto-regenerated by pre-commit hook)
6. `PROJECT_DETAILS.md` (canonical route list)

Plus: `npm run sdk:count` and reconcile the cited counts everywhere they appear; `npm run openapi:generate` + `npm run api:inventory:generate`; verify with `openapi:check` / `api:inventory:check` / `docs:check`. This doc tax is most of why the full build is large — budget for it explicitly.

Versioning: platform + both SDKs share one version; bump with `npm run version:set <x.y.z>` and classify the release per `contracts/sdk/release-plan.json`.

## 7. Reference consumer: budget-aware-research-agent

The research agent (~3.5K LOC Node/ESM, separate repo) is wired as the first governed consumer — **no code moves into DashClaw**:

- its existing `logs/cost-ledger.jsonl` → pushed through the SDK as purchase records;
- its existing free-vs-paid routing decision (`run-prototype.mjs:makeDecision`) → a `guard` call before escalating to paid;
- its existing provider discovery (402 Index) → reconciled against the DashClaw provider registry;
- its existing agentcash execution → unchanged; it remains the agent-side executor (§2).

This proves the entire what/why/how-much/worth-it loop end-to-end and is the demo asset. It also validates the boundary: a real agent spends real money, and DashClaw governs it without ever touching the wallet or a provider.

## 8. Coordination & sequencing (timing, not scope)

A full build touches `schema/schema.js`, `drizzle/*.sql`, both SDKs, routes, repositories, the dashboard, and every generated artifact — **the exact surface a concurrent session is mutating** (Agent Registry + Agent Reputation + "Group A: absorbing sibling repos"). Building in parallel risks collisions on schema migrations, the SDK surface, and generated artifacts, and violates the multi-agent-hygiene rule (*touch only what you edit; never sweep another agent's unstaged work*).

**Recommended sequence:**

1. **Land first (other session):** Agent Registry, Agent Reputation, Group-A consolidation — committed and on `main`.
2. **Then Phase 1 (this pillar):** registry tables + provider/endpoint/policy models + `action_records` purchase subtype + repositories + migrations. Connect the provider registry to the now-landed Agent Registry conventions.
3. **Phase 2:** the governed loop end-to-end + the research agent pushing real records (first demo).
4. **Phase 3:** operator surfaces (registry view, spend dashboard, approval queue, detail drawer).
5. **Phase 4:** cost-to-value scoring + provider ranking/deprioritization; SDK parity + the full doc checklist closed out.

This also makes the build cheaper: reputation and registry are things the spend layer should sit _on top of_, not _beside_.

## 9. Non-goals (explicit)

- No wallet, no key custody, no settlement inside DashClaw.
- No x402 executor or provider adapters inside DashClaw (§2).
- No two-sided / "sell your agents' services" marketplace.
- No consumer-facing payments UX.
- No research-agent code merged into DashClaw.
- No irreversible transactional automation in v1 (data-access purchases only).
- No open-ended provider sprawl — curated registry, phased provider onboarding.

## 10. Open questions for the plan stage

- Final modeling choice: extra columns on `action_records` vs a joined `x402_purchases` detail row keyed by `action_id`.
- Exact id-prefix and org-scoping conventions to share with the Agent Registry (resolve after it lands).
- Whether the agent-side thin x402 client ships as a published package or stays in the consuming agent for v1.
- Which single provider category seeds the registry first (the strategy doc's Tier 1 leads with Exa/Firecrawl research).

## 11. Next step

When the concurrent session's work is committed and the operator is ready, transition to the `writing-plans` skill to produce the phased implementation plan from §8. Do not begin implementation while the other session holds the schema/SDK surface.
