# Governance Posture Score + Remediation Loop — Design Spec

- **Date:** 2026-06-05
- **Status:** Design-only (no implementation in this pass — repo has an active TypeScript migration in flight)
- **Author:** Claude (brainstormed with Wes)
- **Topic origin:** "Copy the desloppify idea for DashClaw" — an install-prompt whose payoff is DashClaw *scanning* an instance, producing a **governance score**, and driving a **next → fix → resolve** remediation loop.

> **A note on file paths in this spec.** The codebase is mid-migration from JS to strict TypeScript on `refactor/typescript-migration`. Existing modules are referenced **by responsibility**, not by a pinned `.js`/`.mjs` extension, because those extensions are flipping to `.ts` as the migration lands. All **new** files proposed here are TypeScript (`.ts` / `.tsx`). Confirm exact existing-module paths/extensions at implementation time. The **data model** (table/column names) is stable across the migration — the JS→TS conversion is behavior-preserving and does not rename Postgres columns.

---

## 1. Summary

A single, gaming-resistant **org-wide governance posture score (0–100)** computed from what the DashClaw instance can do versus what it actually governs, presented as a legible dimension breakdown, and made *actionable* through a prioritized remediation queue (`next`) where each finding resolves into a **human-gated** policy draft. It is delivered as a `/posture` page, a `/api/posture` API, `dashclaw posture` / `dashclaw next` CLI commands, and `dashclaw_posture` MCP tools so both operators and a governing agent can drive the loop.

This is **govern-the-governance meta**, fully on-mission for a "minimal governance runtime, not an agent platform." It is built almost entirely by *aggregating primitives that already exist* (the doctor scan engine, the Policy Coach recommendation engine, the guard policy types, the action/decision ledgers) — the genuinely new work is the score model and the loop UX.

## 2. Decisions locked during brainstorming

| # | Decision | Choice |
|---|----------|--------|
| 1 | **Scope** | One **org/instance-wide** score (not per-agent in v1). |
| 2 | **Inputs** | **Both, degrading gracefully** — static config baseline + behavioral signal once traffic exists. |
| 3 | **Loop power** | **Guided + human-gated** — resolving creates *inactive* policy drafts; a human activates anything that changes enforcement. The score never rises from drafting alone, only from an active, *proven-to-fire* policy. |
| 4 | **Surface** | New **`/posture` page + `/api/posture` + CLI + MCP**. |

## 3. Non-goals (YAGNI)

- **No auto-activation of enforcement policies.** The human gate on `block` / `require_approval` / spend caps is a permanent design property, not a v1 shortcut.
- **No per-agent score** (deferred; org-level only).
- **No new doctor check categories.** Reuse the existing `governance` category; do not fork the scan engine.
- **No cloud upload of local Policy Coach samples.** Respect the existing local-only sample model; behavioral signals that depend on samples degrade gracefully to absent.
- **No cron / real-time recompute.** Free-tier constraint — compute on demand (GET), persist a trend snapshot on explicit scan.

## 4. The score model (the crux)

The whole value of the feature is a number that **resists gaming**: the only way to raise it is to actually reduce ungoverned risk. The model is **A-engine / B-presentation / C-adjustment**:

### 4.1 Engine — risk-weighted *proven* coverage (A)

**Governable units.** A unit is a governable surface — a registered capability (keyed by slug) or an observed `action_records.action_type`. The unit set is the union of:
- **Registered capabilities** — the `capabilities` table (`risk_level` ∈ {low, medium, high, critical}, `requires_approval` 0/1, `pricing_json`, `source_type`). Queried via raw SQL inside the repository; **note it is not mirrored in the Drizzle `schema.js` defs**, so the posture repo reads it directly (repos are exempt from the route-SQL guard).
- **Observed `action_records.action_type`** values — real behavior, carrying the per-action `risk_score` (0–100) and `reversible` flag. This is where reversibility and *numeric* risk come from, and it means you cannot hide a unit by not registering the capability while still performing the action.
- **x402 spend surfaces** — providers the fleet pays (`source_type = external_marketplace` capabilities + the x402 repository).

**Risk weight per unit** `w`:

```
w = riskFactor(risk_score) × reversibilityFactor(reversible) × spendFactor(unit) × frequencyFactor(count)
```

- `riskFactor` — a capability's categorical `risk_level` maps directly to a low/med/high/critical multiplier (e.g. 1 / 3 / 8 / 16). For behavior-only units (an observed action_type with no registered capability), bucket the observed `action_records.risk_score` (0–100) into the same four tiers.
- `reversibilityFactor` — irreversible units weigh more (e.g. ×2 when observed `action_records.reversible = 0`). Capabilities carry no reversibility column, so this factor is always behavior-derived.
- `spendFactor` — capabilities with a non-empty `pricing_json` or `source_type = external_marketplace`, and x402-paid providers, weigh more (e.g. ×2).
- `frequencyFactor` — `1 + log10(1 + observed_count)`. Dampened so a rare-but-catastrophic unit still counts, but a frequently-exercised high-risk unit dominates. **Frequency cannot be faked** — it comes from the ledger.

**Coverage grade per unit** `g ∈ [0, 1]`. A unit is graded by replaying its representative risky action through the **shared guard/simulator evaluator** (the same policy-model used by Policy Coach's simulate, so "would this fire?" is faithful to the real guard):
- `block` / `require_approval` that fires → **1.0** (full).
- `warn` that fires → **0.5** (partial).
- policy exists but does not change the decision on replay, or no policy → **0.0**.
- Required-infra gate: high-risk units additionally require **identity binding** present (`agent_identities`) and data-touching units require **redaction** enabled — missing infra caps `g` for that unit.

**Raw score** = `100 × Σ(g × w) / Σ(w)` over all units.

### 4.2 Presentation — dimension maturity (B)

Every unit and finding maps to exactly one of **six dimensions**, each scored as the risk-weighted coverage *restricted to its units* (its own 0–100):

1. **Identity** — acting agents bound to a verifiable identity (`agent_identities`, JWKS/act-binding). Unidentified agents acting = gap.
2. **Enforcement** — risky capabilities have *firing* guard policies (the bulk of coverage weight). A capability's declared `requires_approval = 1` is *intent*, not coverage — it only counts when a guard policy actually realizes it on replay (a capability marked requires-approval with no firing policy is itself a high-severity finding).
3. **Spend** — x402 / cost-bearing surfaces have `x402_spend_limit` (or cost) caps.
4. **Auditability** — actions recorded with outcomes synced (no dangling `pending`; outcome follow-through).
5. **Approval discipline** — HITL approvals resolved, not abandoned/expired.
6. **Data protection** — redaction / PII handling on data-touching actions.

The **org score is the risk-weighted roll-up across dimensions** (weighted by the risk mass each dimension governs — *not* a flat average), so dimensions covering more real risk move the number more. The UI shows the org number **and** the six dimension scores.

### 4.3 Adjustment — behavioral signal + incident caps (C)

Once traffic exists, fold in honest outcome signal (and gracefully skip when absent):
- **Incident penalty + hard cap.** For each ungoverned high-risk action that actually fired in the trailing window (`guard_decisions.decision = allow` on `risk_score ≥ high`, or a high-risk `action_records` row with no matching active policy): subtract, and **cap the org score** (e.g. ≤ 60 while any active high-risk leak exists in the last 24h). *This is the "you can't sit at 95 while leaking ungoverned risk" guarantee.*
- **Approval follow-through.** Ratio of approvals resolved vs abandoned/expired feeds the Approval dimension.
- **Policy Coach open gaps.** Each high-confidence un-adopted suggestion reduces coverage of its unit (it is evidence of an observed, uncovered risk).

### 4.4 Anti-gaming properties (must be asserted by tests)

| Gaming attempt | Why it fails |
|---|---|
| Add a toothless `allow` policy | Replay still returns `allow` → `g = 0`, no coverage gain. |
| Add many duplicate policies | Coverage is **per-unit, deduplicated** — N policies on one unit credit the same as 1. |
| Add a policy on a capability you never use | That unit's `frequencyFactor` is ~1 and its weight is dominated by risk × frequency → negligible score gain. Frequency can't be faked. |
| Un-register a risky capability to dodge it | The unit persists via observed `action_records.action_type` — you can't hide a surface you're still exercising. |
| Paper over a live leak with config | The **incident cap** holds the score down until the leak is actually governed. |

The model is **pure and deterministic**: same inputs → same score and same finding keys (enabling stable resolve/snooze state, exactly like Policy Coach's deterministic suggestion ids).

## 5. Findings & the remediation loop

### 5.1 Finding shape

Each finding is an uncovered/partially-covered unit or a behavioral gap:

```ts
interface PostureFinding {
  key: string;            // deterministic — hash(dimension + unit/gap identity); stable across scans
  dimension: Dimension;   // one of the six
  severity: 'critical' | 'high' | 'medium' | 'low'; // from recoverable risk weight + incident status
  title: string;
  evidence: {             // evidence-over-decoration: real counts + sample ids, never prose filler
    observedCount: number;
    exampleActionIds: string[];
    exampleEventIds?: string[];
  };
  scoreDelta: number;     // points recovered if resolved+activated — the "this is worth X" hook
  fix: PostureFix;
  status: 'open' | 'drafted' | 'resolved' | 'snoozed' | 'accepted_risk';
}

type PostureFix =
  | { type: 'create_policy_draft'; policyType: string; rules: unknown } // pre-filled, simulatable
  | { type: 'bind_identity'; agentId: string }
  | { type: 'enable_setting'; setting: 'redaction' | 'approval_channel'; deepLink: string }
  | { type: 'adopt_coach_suggestion'; suggestionId: string; deepLink: string }
  | { type: 'review_incident'; actionIds: string[]; deepLink: string };
```

### 5.2 Queue ordering (`plan queue` analog)

Order by `scoreDelta` desc → tie-break `severity` → tie-break observed frequency (most-active uncovered risk first). `next` returns the single top open finding; the page shows the ordered list.

### 5.3 Resolve mechanics (human-gated, the key honesty property)

- `create_policy_draft` → insert an **inactive** `guard_policies` row (`active = 0`), reusing the existing Policy Coach "adopt as inactive draft" path. Mark the finding **`drafted`**, *not* `resolved`. **Drafting does not raise the score.** Only when a human activates the policy at `/policies` *and the next scan proves it fires* does the unit become covered and the score rise. This is what makes the number trustworthy and keeps enforcement human-gated.
- `snooze` / `accept_risk` → record state + actor + note; excluded from the queue but surfaced in a **"Risk accepted" ledger** (audit trail for the compliance audience).
- Via MCP/CLI, resolve is **draft-only** — a governing agent can prepare the fix but can never self-activate enforcement (consistent with the consumer-connector ban on agents escalating their own governance).

**The loop:** `scan` → `next` (top gap) → `resolve` (creates draft) → *human activates at `/policies`* → rescan → score rises. Repeat until the queue is dry.

## 6. Architecture

All new code is TypeScript; all DB access goes through a repository (route-SQL guardrail — no direct SQL in `app/api/**/route.ts`).

```
app/lib/posture/
  signals.ts     Gather raw signals. Reuses: doctor `governance` checks, the Policy Coach
                 analyzer, and repository reads (capabilities.repository.ts,
                 registered-agents.repository.ts, guard_policies, action_records,
                 guard_decisions, x402.repository.ts / finops.repository.ts).
  model.ts       The score. risk weights → proven-coverage ratio → dimension mapping →
                 behavioral adjustment + incident caps. Pure + deterministic + unit-tested.
  findings.ts    Gaps → prioritized findings, each with a concrete human-gated fix.
  types.ts       Shared types (PostureFinding, Dimension, PostureFix, scores).
  (shares the guard/simulator evaluator so "would this policy fire?" is faithful to guard)

app/lib/repositories/posture.repository.ts
  Reads for signals; writes finding state + snapshots; reuses insert-inactive-policy for drafts.

app/api/posture/route.ts                       GET → { score, status, dimensions[], snapshotTs, summary }
app/api/posture/findings/route.ts              GET → prioritized next-queue (filter by status/dimension)
app/api/posture/findings/[key]/resolve/route.ts  POST { action: 'create_draft'|'snooze'|'accept_risk', note? }
app/api/posture/scan/route.ts                  POST → recompute + persist a trend snapshot

app/posture/page.tsx                           Operator surface (.tsx — JSX parses under the TS/Vitest loader)

cli:  `dashclaw posture` | `dashclaw next` | `dashclaw posture resolve <key>`
mcp:  `dashclaw_posture` (score+breakdown+findings) | `dashclaw_posture_next` (top finding)
```

### 6.1 Storage (new migration)

One new migration file (`drizzle/00XX_posture.sql`) — **author it, but apply via `npm run db:migrate` at implementation time; do not run it during this design pass.**

- `posture_findings_state(org_id, finding_key, status, note, actor, created_at, updated_at, PRIMARY KEY (org_id, finding_key))` — so resolved/snoozed/accepted findings don't re-surface. Keyed by the deterministic `finding_key`.
- `posture_snapshots(id, org_id, score numeric, dimensions jsonb, created_at)` — trend line; "the number going up" is the motivator.

> **Numeric coercion reminder:** the Neon HTTP driver returns `numeric` columns as strings. Coerce `Number()` on `score` before any arithmetic/aggregation (known repo gotcha).

## 7. UI — `/posture` (honoring `.impeccable.md`)

Dark-only, token-first (no hardcoded hex), orange as **signal not fill**, calm-under-pressure, evidence-over-decoration, `lucide-react` icons, tabular-nums on every number, tiny uppercase mono meta-labels. Anti-reference guardrail: must not read as generic-SaaS / consumer-AI / heavy-enterprise / crypto.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ GOVERNANCE POSTURE                                          [ Rescan ⟳ ]     │
│                                                                              │
│        ┌──────────┐   Needs attention · 3 critical gaps                     │
│        │    72    │   ▁▂▃▅▆▆▇  (30-day trend)                                │
│        │  / 100   │   +14 points recoverable from the queue below           │
│        └──────────┘                                                          │
│                                                                              │
│  IDENTITY   ENFORCEMENT   SPEND      AUDIT      APPROVAL   DATA              │
│    88          61 ◾        45 ◾       90          78          70             │
│  ▔▔▔▔▔▔▔     ▔▔▔▔▔▔▔     ▔▔▔▔▔▔     ▔▔▔▔▔▔▔     ▔▔▔▔▔▔     ▔▔▔▔▔▔            │
│            (orange tick only on the dimensions that need attention)         │
├────────────────────────────────────────────────────────────────────────────┤
│ NEXT — prioritized remediation queue                                        │
│                                                                              │
│ ◾ CRITICAL  +6  Spend   x402 calls to 3 providers have no spend limit       │
│                 142 paid calls observed · no x402_spend_limit policy fires   │
│                                                          [ Review fix → ]    │
│ ◾ CRITICAL  +5  Enforce  Destructive shell actions reach allow ungoverned   │
│                 38 high-risk actions, 0 gated · draft risk_threshold ready   │
│                                                          [ Review fix → ]    │
│ ◽ HIGH      +3  Identity 2 agents acted without a bound identity            │
│                                                          [ Review fix → ]    │
│ … 6 more                                                                     │
├────────────────────────────────────────────────────────────────────────────┤
│ ▸ Risk accepted (2)   — snoozed / accepted-risk findings, with who & why    │
└────────────────────────────────────────────────────────────────────────────┘
```

"Review fix →" opens a draft preview (policy type + rules + a simulate summary reusing the Policy Coach simulator), then **Create draft** → inactive policy on `/policies`. The score on this page does **not** move until that draft is activated and the next scan proves it fires.

## 8. Phasing (build sequence — for a later `writing-plans` pass)

1. **Score engine, no UI.** `posture/signals.ts` + `model.ts` + `types.ts`; fixture-driven unit tests asserting every §4.4 anti-gaming property; `GET /api/posture` returns score + dimensions. *Prove the score can't be gamed before building UX on it.*
2. **Findings + loop API.** `findings.ts`, `posture.repository.ts`, the migration, `GET /api/posture/findings`, `POST .../resolve` (draft creation via the existing inactive-policy path), `POST /api/posture/scan` (snapshot).
3. **`/posture` page** + trend snapshots.
4. **CLI + MCP** surfaces.
5. **Ship pass.** Run the `dashclaw-ship` accuracy sweep: docs (`app/docs`, `sdk/README.md`, `sdk-python/README.md`), `openapi:generate`, `api:inventory:generate`, `PROJECT_DETAILS.md`, livingcode refresh, SDK method counts, and the unified platform+SDK version bump (`npm run version:set` → `npm run release:sdks`).

## 9. Testing

- **Unit (`model.ts`)** — crafted fixtures asserting: toothless policy → 0 gain; duplicate policies → single-unit credit; incident cap engages; frequency dampening; coverage requires *proven firing* via the shared evaluator; deterministic finding keys stable across runs.
- **Integration (API)** — route shapes; `resolve: create_draft` inserts an **inactive** policy and does **not** raise the score; snooze/accept_risk persist and drop from the queue.
- **Gates** — full suite `npx vitest run` (not targeted), `npx next build` (any `app/**` change), plus `lint`, `route-sql:check`, `openapi:check`, `api:inventory:check`, `version:check`.

## 10. Reuse map (what this stands on, so it stays small)

| Need | Existing primitive (reference by responsibility; confirm path post-migration) |
|------|------------------------------------------------------------------------------|
| Scan skeleton (pass/warn/fail + fix metadata) | doctor engine + `governance` checks + `/api/doctor/fix` |
| "Would this policy fire?" replay | the shared guard/simulator policy-model used by Policy Coach |
| Policy recommendations + inactive-draft adoption | Policy Coach analyzer + its adopt-as-inactive path |
| Numeric risk / reversibility / frequency signal | `action_records` (`risk_score`, `reversible`, `action_type`, observed counts) |
| Capability surface + declared risk / approval / pricing | `capabilities` table via `capabilities.repository.ts` (`risk_level`, `requires_approval`, `pricing_json`, `source_type`) — raw-SQL table, **not** in Drizzle `schema.js` |
| Decision outcomes / leaks | `guard_decisions` (`decision`, `risk_score`) |
| Identity binding signal | `agent_identities`; registered agents via `registered-agents.repository.ts` |
| Spend signal | `x402.repository.ts` + `finops.repository.ts`; capability `pricing_json` |
| Enforcement vocabulary | the 13 `POLICY_TYPES` (incl. `risk_threshold`, `protected_path`, `x402_spend_limit`) |

---

### Next step (when the TS migration lands)

Transition to the `writing-plans` skill to turn §8 into a phased implementation plan with per-phase verification. **Not started in this pass** — design-only, by request, while the migration is active.
