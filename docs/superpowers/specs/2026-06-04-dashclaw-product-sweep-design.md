# DashClaw Product Sweep — FE/BE Parity, IA Cleanup, Face-lifts & Bug Fixes

_Design spec · 2026-06-04 · author: sweep audit (Wes Sander)_

## Context & goal

Over the last ~48h DashClaw shipped Group A (policy authoring), Group B (Agent Reputation),
and Group C (Agent Registry) plus a batch of "wire orphaned backend" UI. A two-phase read-only
recon (8 agents) found that much of the new backend/SDK surface has **no front door**, the IA has
**redundant pages**, several screens **drift into the banned anti-references**, and there are
**real bugs hiding live governance signals**.

**Goal:** one deliberate sweep that makes DashClaw look and behave like a professional product —
every shipped capability reachable, no duplicate surfaces, every page on the design system, and
the silent-failure bugs fixed. Scope is bounded by the eight work-streams below; no speculative
features.

This spec is the execution contract. Work is driven by dynamic workflows in waves, with a full
verification gate (`npm run lint` + `npx vitest run` + `npx next build` + contract checks) between
waves. No PRs — commit and push to `main` (per project convention).

## Decisions locked (operator, 2026-06-04)

1. **Activity vs Agent Summary** → keep `/activity`, fold Agent Summary's good parts in, retire `/my-agent`.
2. **Agent Sessions** → **fix, don't remove.** Make `/sessions` genuinely useful by grounding it in real data.
3. **Reputation + Registry parity** → **build all high-severity surfaces.**
4. **Swarm** → **redesign** to the governance aesthetic (keep the graph, kill the crypto/web3 styling).

Auto-go (no decision needed, standard cleanup): the bug-fix sweep and the token/design-system
defect cleanup.

## Design rules (apply to every visual change)

Per `.impeccable.md` + `app/globals.css`:
- Dark-only; `#0a0a0a` canvas; **never hardcode hex** — use tokens (`bg-surface-*`, `border-border*`,
  `text-*`, `status-*`, `bg-brand`/`brand-subtle`).
- Brand orange = **signal only** (active/attention/primary/brand). Not link color, not ambient fill.
- `lucide-react` icons only — **no emoji**.
- 12px card radius (the `Card` atom); `tabular-nums` on data columns; WCAG 2.1 AA floor.
- Reuse shared components (below), don't roll your own.

### Shared components (confirmed APIs — reuse these)

- `Card` / `CardHeader` / `CardContent` — `app/components/ui/Card.js`. `CardHeader{title,icon,action,count}`.
  Registry/agents pages inline a custom header `div.border-b.border-border.px-5.py-3.text-sm.font-semibold.text-white` for section panels — mirror that.
- `Badge` — `app/components/ui/Badge.js`. **Variants (only these): `default | success | warning | error | info | brand`.** Sizes `xs | sm`. Unknown variant → silently `default`.
- `EmptyState{icon,title,description,action}` — `app/components/ui/EmptyState.js`.
- `Skeleton` / `ListSkeleton{rows}` / `CardSkeleton` / `StatSkeleton` — `app/components/ui/Skeleton.jsx`.
- `Stat` / `StatCompact{label,value,color}` — `app/components/ui/Stat.js`.
- `ProgressBar{value,color}` — `app/components/ui/ProgressBar.js` (colors incl. `purple`). Good for 0–100 score bars.
- `PageLayout{title, subtitle, breadcrumbs[], actions, maturity}` — `app/components/PageLayout.js`.
  **Accepts `subtitle`, NOT `description`.** Maturity ∈ `stable|beta|experimental`.
- Per-agent profile sections — `app/agents/[agentId]/components/*` (`AgentVitalsStrip`, `AgentTrustPosture`, `AgentDecisionTable`, …). The drill-down pattern: a `max-w-5xl space-y-6` vertical stack of self-contained section components.
- Fleet table pattern — `app/agents/page.js:179-272` (uppercase `tracking-[0.14em] text-tertiary` thead, `tbody divide-y divide-border`, `hover:bg-white/[0.02]`).

---

## Work-stream 1 — Bug-fix sweep (Wave 1, auto-go)

| # | Bug | Fix |
|---|-----|-----|
| 1 | **5 callers fetch `/api/actions/signals` → 404** (route moved to `/api/signals`). Mission Control, Security, compliance page, `RiskSignalsCard`, `SystemStatusBar` all silently show "all clear" and hide live integrity signals — a governance false-negative. | Repoint all 5 to `/api/signals` (keep `?agent_id=`). Files: `app/mission-control/page.js:145`, `app/security/page.js:101`, `app/compliance/page.jsx:100`, `app/components/RiskSignalsCard.js:37`, `app/components/SystemStatusBar.js:26`. Also fix the stale path comment in `app/lib/signals.js:2`. |
| 2 | Landing hero CTA "Run live demo" → `#live-demo` anchor that doesn't exist (dead button). | Point the CTA at `/demo` (real route). `app/page.js:61`. |
| 3 | `/docs` "Agent Tools (Python)" nav → `#agent-tools` (missing); also the target of landing deep-link `app/page.js:723`. | Remove the nav item + the landing deep-link (no such section). `app/docs/page.js:183`. |
| 4 | 9 legacy `/docs` nav anchors point to non-existent sections (shown under "Show Legacy"). | Remove the 9 dead nav entries. `app/docs/page.js:186-203`. |
| 5 | `/downloads` advertises Node SDK "Canonical 104-method surface"; real count is **116**. | Update to 116 (current `npm run sdk:count`). `app/downloads/page.js:339`. |
| 6 | `/guides/claude-code` renders literal `<SCREENCAST_URL>` placeholder to visitors. | Hide Step 1 walkthrough + footer screencast card until a real URL exists. `app/guides/claude-code/page.js:104,258`. |
| 7 | Policy import modal renders the mode selector **twice** (cards + redundant pills). | Remove the duplicate pill block. `app/policies/components/PolicyAdvancedImportPanel.jsx:121-144`. |

Verify: each fixed fetch returns 200 against the live route; full suite green.

## Work-stream 2 — Token / design-system defect cleanup (Wave 1, auto-go)

- **`/scoring` (Quality) — real defects, not just style:**
  - Every `<Badge color="…">` (`blue`/`zinc`/`green`/`red`) uses a **non-existent prop** → all render default gray. Convert to `variant=` with the correct value (`info`/`default`/`success`/`error`). Lines 456-458, 618-619, 707-709.
  - `PageLayout description=` (line 346) is **dropped** → rename to `subtitle=`.
  - ~20 `border border` (undefined color) → `border border-border`. Lines 382-748.
- **Hardcoded-hex → token** cleanups (replace `bg-[#111]` / `border-[rgba(...)]` / `bg-[#0a0a0a]` with `bg-surface-*` / `border-border*` / canvas token), per recon:
  - `app/learning/analytics/page.js` (row bgs across all tabs; off-palette `purple-400`/`purple-500` maturity → use a token color or `ProgressBar` purple; raw `alert()` → inline error using `error-subtle`).
  - `app/prompts/page.js` (inputs + list rows).
  - `app/guides/*` (canvas `bg-[#0a0a0a]`, `rounded-3xl` cards w/ hardcoded borders → token + 12px card atom).
  - `app/approve/page.js` (attention-critical surface — full palette hardcoded; `rounded-2xl` → card atom).
  - `app/invite/[token]/page.js` (6× `bg-[#0a0a0a]` → inherit body/token).
  - `app/dashboard/page.js:165` (single tokenless input).
  - `app/workflows/page.jsx:212,217` + `app/workflows/[templateId]/page.jsx:342` (segmented control / select hardcoded).
  - `app/policies/components/PolicyAdvancedImportPanel.jsx` + `PolicyRuleBuilderSection.jsx` (input/chip hex).

Verify: `grep` for `#[0-9a-f]{3,6}` and `border-\[rgba` in touched files returns nothing new; visual parity preserved.

## Work-stream 3 — IA merge: Activity ← Agent Summary (Wave 2)

**Keep `/activity`** (data superset: `/api/actions` + `/api/guard` **+** `/api/activity` audit events, with
in-place realtime patching + day-grouping). **Retire `/my-agent`.**

Carry into `/activity` (nothing user-valuable lost):
1. Narrative hero sentence — port `buildNarrative()` from `app/my-agent/page.jsx:33-48`, render above the feed.
2. Today / This-week scope toggle (`my-agent/page.jsx:105-117`) — Activity currently only has a 50-event cap.
3. Pinned "Denied actions" section with `extractPolicyName` (`my-agent/page.jsx:50-55,201-247`).
4. `InstallPromptHero` empty-state (3-step hook install + guide links, `my-agent/page.jsx:309-374`) — replaces Activity's generic `EmptyState`.

Then:
- Delete `app/my-agent/page.jsx` + `__tests__/unit/my-agent-page.test.jsx`; migrate still-relevant assertions onto an Activity test.
- `Sidebar.js:35` — drop the "Agent Summary" (`/my-agent`) item (the leaderboard from WS6 takes the `Bot`/reputation slot in Observe).
- Remove `/my-agent` from `NEWLY_GATED` in the middleware page-gating test/config.
- Keep `app/activity/dayGrouping.js` + its test (Activity-only).
- Shared event row = `app/components/ActivityTimeline.js`.

Verify: `/activity` shows narrative + scope toggle + denied pin + install empty state; `/my-agent` 404s / nav clean; full suite green incl. updated gating test.

## Work-stream 4 — Agent Sessions fix (Wave 2)

**Root cause:** `branch`, `green_level`, `branch_freshness`, `commits_behind`, `blocked_reason` are bound
to a CI/branch-telemetry source that was never built — no writer sets them. Sessions only ever get
`{agent_id, workspace, branch?, status}` (MCP `session_start/end`, OpenClaw plugin, SDK). "pico" =
an OpenClaw-hosted agent's `agent_id`.

**Fix = ground the page in data that's actually written (`action_records`) + salvage the dropped summary.**

Backend:
1. **Migration (additive):** add `session_id TEXT` to `action_records` (`schema/schema.js` + new `drizzle/00XX_*.sql`, idempotent) with index on `(org_id, session_id)`. Leave the dead CI columns in the table (removing is more churn than worth) — just stop surfacing them.
2. `POST /api/actions` (the `dashclaw_record` path) — accept optional `session_id`, persist on `action_records`. Then MCP `dashclaw_record` (`mcp-server/lib/tools.js:483-501`), OpenClaw plugin, and both SDKs can stamp the active session id. **No route-local SQL** — go through the repository.
3. `PATCH /api/sessions/[sessionId]` — accept the `summary` field that `session_end` already sends and currently **drops** (`route.js:35`); store it as the terminal `session_events.detail` (generalize `app/lib/sessions.js:145-152`).
4. `listSessions` / `getSession` (`app/lib/sessions.js`) — LEFT JOIN aggregate from `action_records` (by `session_id`, falling back to `agent_id` + session time-window until callers stamp it): `action_count`, real `last_activity`, `total_cost` (**`Number()`-coerce** per the pg-numeric-string gotcha), `max_risk`, last decision (`outcome_status`/`declared_goal`), `event_count`.

Frontend:
- List (`app/sessions/page.js`): columns → **Status | Agent | Workspace | Actions (count) | Last Activity | Duration | View**. Drop Green Level. Fix the duration bug: treat **all terminal statuses** (incl. `completed`) as ended, not just `finished`/`failed` (line 215) — OpenClaw closes with `completed`, so today they show ever-growing live durations.
- Detail (`app/sessions/[sessionId]/page.jsx:218-243`): replace the 4 dead CI cards with **# Actions / Total Cost / Max Risk / # Events**; keep the Blocked alert (reachable via PATCH) + the event timeline (the one genuinely-populated surface); render the terminal-event detail as the session **summary**.

Contracts/docs (per project SDK checklist): drop the green/freshness/commits fields from `updateSession`/`update_session` docstrings (`sdk/dashclaw.js:794`, `client.py:1734`); document `session_id` on record in `app/docs/page.js` + both SDK READMEs + `PROJECT_DETAILS.md`; regenerate `api-inventory` + `openapi`.

Verify: a recorded action with `session_id` appears in its session's Actions count + cost; completed sessions show fixed duration; `session_end` summary renders; full suite + `route-sql:check` + `openapi:check` + `api:inventory:check` green; `npm run db:migrate` applies cleanly.

## Work-stream 5 — Agent Registry parity (Wave 3)

Make Group C reachable and operable (all endpoints + SDK methods already exist).

- **Reachability:** add `/agents/registry` to `Sidebar.js` (Govern group, near Fleet). Currently linked nowhere — orphan.
- **Invoke** (`POST /api/agents/invoke` body `{registered_agent_id, capability_id, agent_id?, payload?, declared_goal?}`): an Invoke form in the registry detail pane — agent select, capability select (from `detail.capabilities`), optional caller `agent_id` (from `/api/agents`), `declared_goal`, payload JSON textarea; show governed result + resulting `action_id`. Mirror the create-form pattern (`registry/page.jsx:99-134`).
- **Add capability** (`POST /api/agents/registry/[id]/capabilities {capability_id}`): a picker populated from `GET /api/capabilities` (`{capabilities:[{capability_id,name,risk_level,...}]}`), filter out already-grouped, show `risk_level` via `Badge size=xs`; refresh the Capabilities card on success.
- **Edit / deactivate** (`PATCH /api/agents/registry/[id]`, `PATCHABLE = name/endpoint/auth_type/risk_class/default_budget_usd/status`): Edit reuses the create-form pre-filled; **Deactivate = PATCH `{status:'inactive'}`** (no DELETE route). Reflect via the status Badge.
- **Polish:** format `inv.created_at` (raw ISO today, `registry/page.jsx:218`); add a Skeleton on the detail pane while loading.

Verify: registry reachable from nav; can register → add capability → invoke (produces an action visible in `/decisions`) → edit/deactivate; full suite + `route-sql:check` green.

## Work-stream 6 — Agent Reputation parity (Wave 3)

Group B is dormant from the UI. **Key everything on `action_records.agent_id`** (== `/api/agents` agent_id == `/agents/[agentId]` route param), NOT the registry slug.

- **Fix the mismatch:** the registry reputation card (`registry/page.jsx:52`) fetches by **slug** → always empty. Re-key to the registered agent's governed `agent_id` if the model carries one, else **remove the card from registry** and surface reputation where governed agents live (per-agent profile + leaderboard). _Decision in plan: registry data model doesn't carry a governed agent_id → remove the registry card, move reputation to the agent profile + a leaderboard._
- **Reputation leaderboard (NEW page `/reputation`):** `PageLayout(title='Reputation', maturity, breadcrumbs=['Observe','Reputation'])`; fetch `GET /api/reputation/leaderboard?limit=`; fleet-table rows = `agent_id` (Link to `/agents/[agentId]`) + reliability/completion/confidence (`StatCompact` + `ProgressBar`); `ListSkeleton` loading; `EmptyState` empty. Add to `Sidebar.js` Observe group (takes the slot freed by retiring Agent Summary).
- **Per-agent reputation drill-down:** new section component under `/agents/[agentId]` (mirror `AgentTrustPosture.jsx` structure) fed by `GET /api/reputation/agents/[agentId]/summary` (`{summary:{...vector, is_active}}`); Metric tiles for the 0–1 scores (registry `Metric()` pattern / `StatCompact` + `ProgressBar`); optional events drill (`GET .../events`).
- **Recompute action:** a "Recompute" button (copy the agent-profile Refresh button, `agents/[agentId]/page.js:105-111`, `RotateCw`) → `POST /api/reputation/agents/[agentId]/recompute` then re-fetch. **This is what populates `agent_reputation_snapshots`** — without it the leaderboard is permanently empty. Consider a bulk "Recompute all" on the leaderboard.
- **(Optional, low) Receipt:** "Download signed receipt" / "Verify" from `GET .../receipt` + `POST /api/reputation/verify`, paralleling the compliance proof-export pattern. Build only if time permits.

Verify: recompute on an agent with actions → snapshot persists → agent appears on the leaderboard with non-zero scores; per-agent drill-down renders real vector; full suite green.

## Work-stream 7 — Code Sessions rebuild (Wave 4)

Rebuild all three pages on the design system (currently raw `<table>` dumps + a critical wall-of-text detail page with a banned `⚠` emoji and hardcoded orange-as-alarm).

- **List (`app/code-sessions/page.js`):** keep `PageLayout(maturity='beta')` + `CodeSessionAlertsPanel`; replace `<table>` with the fleet table pattern inside `<Card hover={false}><CardContent className="p-0">`; `EmptyState icon={Terminal}`; project name uses `text-brand` link (not raw orange), move the unread count into a `Badge`.
- **Project (`app/code-sessions/[projectId]/page.js`):** fleet table for sessions + ROI; `Card` + custom header for sections; keep `WeeklyMemoPanel`; show project **slug/name**, not the raw UUID subtitle.
- **Detail (`app/code-sessions/[projectId]/[sessionId]/page.js`) — the worst screen:** mirror the agent-profile `max-w-5xl space-y-6` section stack; header strip modeled on `AgentVitalsStrip`; cost/token/cache as `Stat`/`StatCompact`; the cost-divergence warning → `Card` w/ lucide `AlertTriangle` + `status-warning` tokens (**no emoji**); replace all `orange-*`/`emerald-*` with `brand`/`status-success`/`status-warning` tokens; consistent section-title scale; keep `OptimalFilesPanel`.

Verify: no `orange-`/`emerald-`/hardcoded-hex/emoji in the 3 files; all use Card/Badge/EmptyState/Stat; full suite + build green.

## Work-stream 8 — Swarm redesign (Wave 4)

Keep the force-simulation graph engine (`useForceSimulation`/canvas); strip the crypto/web3 register.

- Copy: kill "Swarm Intelligence", "Neural fleet topology", "Active Neural Web", "Engage Swarm", fake "SYNCED" badge → calm, declarative fleet-topology language.
- Remove glow-spam (`shadow-2xl shadow-brand/20`), `backdrop-blur` decoration, ambient `animate-pulse` ring/dot (reserve motion for live events per tiebreaker #3), `active:scale-[0.98]` bounce, the italic testimonial pull-quote.
- Replace hardcoded canvas hex (`#f97316`/`#ef4444`/`#eab308`/`#22c55e`/`#111`/`#fff`/`#71717a`) and card `bg-[#050505]`/`bg-[#0a0a0a]` with token values (read from CSS vars or a token map for the canvas).
- Inspector/side panels → `Card` + custom header divs + `Badge` + `EmptyState`; agent/action context panels mirror the agent-profile section pattern.

Verify: no hardcoded hex; no banned copy/anti-reference drift; graph still renders; build green.

---

## Execution approach (workflow waves)

Each wave = one or more dynamic workflows (parallel agents over disjoint file sets, or pipelines),
followed by a **verification gate** I run and READ before committing:
`npm run lint` → `npx vitest run` (full suite) → `npx next build` → contract checks
(`openapi:check`, `api:inventory:check`, `route-sql:check`, `version:check`, `docs:check` as relevant).
Commit per logical change; push to `main` after each wave's gate passes.

- **Wave 1** — WS1 + WS2 (bug + token cleanup). Independent file edits; parallel agents on disjoint file clusters.
- **Wave 2** — WS3 (IA merge) + WS4 (Sessions fix, incl. migration → run `db:migrate`).
- **Wave 3** — WS5 (Registry) + WS6 (Reputation). Touch overlapping registry/agent files → sequence carefully (Reputation removes the registry card WS5 leaves; coordinate in one workflow).
- **Wave 4** — WS7 (Code Sessions) + WS8 (Swarm). Pure design rebuilds, disjoint files → parallel.

Adversarial review pass after Wave 3 and Wave 4 (a verifier agent re-checks token/anti-reference
compliance + that each parity surface actually exercises its route).

## Out of scope / risks

- **Out of scope:** new capabilities beyond wiring what shipped; light compliance-nav fix (point Sidebar "Compliance" at `/compliance` not `/compliance/exports`) is a nice-to-have, fold into WS1 if cheap.
- **Risk — Sessions migration:** additive `session_id` column; safe, but requires `db:migrate` locally before the join code runs (else silent 401s per the known gotcha). Sequenced inside Wave 2.
- **Risk — SDK/contract surface:** WS4 touches SDK docstrings + record contract → must run the full doc/contract checklist + regenerate inventories; no new SDK methods, so version bump only if the team's release cadence requires (flag, don't auto-bump).
- **Risk — overlapping registry files (WS5/WS6):** handle in a single coordinated workflow to avoid edit conflicts.
