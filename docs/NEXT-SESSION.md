# DashClaw — Next Session Handoff

**Where we are:** This session shipped a full end-to-end audit (P1–P4 remediation) plus three feature/positioning changes, all committed to `main` with gates green. Live changes: broken eval routes fixed, a Buffer-in-browser crash removed, native-notification credential decryption restored, an admin gate added, guard-validation passthrough for `intel`/`tool`/`write_paths` (4 policy types were dead over HTTP), `workflow.require_approval` honored, capability approval surfaces wired, an `api_keys.key_hash` index migration (0015), an OAuth row purge, and a self-dep bump; the context-thread SDK methods + 4 orphaned pages (tokens/calendar/relationships/content) were retired; the iterative AI policy generator (draft + clarifying chips, never dead-ends, `protected_path` support) was built into Policies→Custom and the orphaned `/policies/generate` page retired; the hero was repositioned from "policy firewall" to "governance runtime." The remaining work below is the swept-up tail: one unfinished retirement, one unpublished breaking SDK change, untracked work to commit/ignore, a backlog of low/info fixes (two of which are real correctness/access-control bugs), and small follow-ups.

## How to operate here

- **ultracode discipline:** author a Workflow for every substantive task — understand → plan → implement → review. Adversarially verify your own findings against the live repo (Read/Grep/Glob), never against memory. The recommendation blocks below were already ground-truthed this session, but re-confirm before acting; the MCP tool count, for example, is **26** (the MEMORY note saying 25 is stale).
- **Verify-before-commit gate (run and READ the output, as its own step):**
  - `npm run lint`
  - `npx vitest run` — the **full** suite (targeted runs miss regressions in unrelated files)
  - `npx next build` — required for any change under `app/**`
  - Guard scripts CI gates: `npm run docs:check`, `npm run version:check`, `npm run openapi:check`, `npm run api:inventory:check`, `npm run route-sql:check`, `npm run contracts:check`
- **Commit + push to `main`. No PRs.** The pre-commit hook auto-regenerates livingcode / openapi / api-inventory artifacts and stages them — never hand-edit generated files under `app/lib/doctor/generated/`, `public/livingcode/`, or `public/downloads/`.
- **Key gotchas:**
  - Run `npm run db:migrate` after any change to `schema/schema.js` or `drizzle/*.sql`, or every authenticated request 401s ("Invalid or missing API key").
  - **No direct SQL in route files** — `app/api/**/route.js` must go through `app/lib/repositories/*.repository.js`; `route-sql:check` blocks increases.
  - **SDK doc-checklist** (when SDK methods change): update `app/docs/page.js`, `sdk/README.md`, `sdk-python/README.md`, `docs/sdk-parity.md`, `PROJECT_DETAILS.md`, then run `npm run sdk:count` and reconcile the cited counts. Canonical live: **Node 104 / Python 207** (after this session's context-thread removal).
  - Read `.impeccable.md` before any UI/copy/visual change. **Never hardcode hex values** (use CSS tokens in `app/globals.css`) or **version numbers** (injected via `next.config.js`; `version:check` fails the build otherwise).

## Prioritized backlog

### P0 — SDK 4.0.0 release-prep: context-thread removal is unpublished and undocumented (effort: S)

**Current state:** Commit `bbbb517b` removed the context-thread methods from both SDK sources (`sdk/dashclaw.js` −34 lines, `sdk-python/dashclaw/client.py`); `node scripts/count-sdk-methods.mjs` now reports **Node 104 / Python 207** (down from 107/211) and grep finds zero `contextThread` matches in source. But nothing else moved: `sdk/package.json` and `sdk-python/pyproject.toml` are still `3.0.0`, `npm view dashclaw version` = 3.0.0, PyPI latest = 3.0.0. `contracts/sdk/release-plan.json` still says `current_version 3.0.0` / `next_bump "none"` / counts 107 & 211. `CHANGELOG.md`'s `## SDK [3.0.0]` documents only the routing/feedback removal (108→107), with no mention of context-thread removal.

**Why it matters:** This is a published-version/source mismatch on a breaking change. If the owner runs `npm run release:sdks` from current source, npm/PyPI reject re-publishing 3.0.0 and the removal never ships; meanwhile `release-plan.json` and the changelog misdescribe the source, so `npm run sdk:count` reconciliation mismatches. It's P0 because it gates every other SDK publish and the metadata is actively wrong.

**Recommended action:** Stage release-prep (do NOT publish — owner publishes). (1) Bump `sdk/package.json`, `sdk-python/pyproject.toml`, and the root `package.json` self-dep `"dashclaw": "^3.0.0"` → `"^4.0.0"`. (2) Add a `## SDK [4.0.0]` CHANGELOG section documenting the context-thread method removal with new counts (Node 107→104, Python 211→207) and the removed method names. (3) Update `contracts/sdk/release-plan.json` counts to 104/207 and set the bump intent. (4) Verify with `npm run sdk:count`, `npm run lint`, `npx vitest run`.

**DECISION NEEDED:** Major (4.0.0) vs minor (3.1.0). Recommend **4.0.0** — removing public methods is semver-breaking. A minor is only arguable if the owner deems the context-thread endpoints to have been effectively-dead (always-404, like the routing/feedback endpoints). Owner confirms whether those endpoints were ever live/used.

**Key files:** `sdk/package.json`, `sdk-python/pyproject.toml`, `package.json`, `CHANGELOG.md`, `contracts/sdk/release-plan.json`, `sdk/dashclaw.js`, `sdk-python/dashclaw/client.py`, `scripts/count-sdk-methods.mjs`, `scripts/release-sdks.mjs`

**First step:** `git show bbbb517b -- sdk/dashclaw.js sdk-python/dashclaw/client.py` to capture the exact removed method names, then bump both manifests to 4.0.0 and add the matching `## SDK [4.0.0]` CHANGELOG entry citing 104/207.

---

### P1 — Commit the governed-chat-harness example; gitignore `.dashclaw/` telemetry (effort: S)

**Current state:** Three untracked paths (`git status --ignored --porcelain` is authoritative). (1) `examples/governed-chat-harness/` shows `??` (committable, NOT ignored) — a polished example mirroring the already-tracked `examples/anthropic-governed-agent/`: README (105 lines), `harness.js` (186), `classify.js` (120), `tools.js` (113), `index.js` (77), `.env.example` (placeholders only, no secrets), `package.json` with `dashclaw: file:../../sdk`. Only its `node_modules/` shows `!!` (ignored). **Trap:** `git check-ignore -v` misleadingly reports `.gitignore:112` for these dirs, but line 112 is blank — an ignored dir can never appear as `??`, so they are genuinely committable. (2) `.dashclaw/behavior-samples/2026-06-03.jsonl` is local Behavior-Learning telemetry (6 events, `agent_id claude-code`) — machine-local, must NOT be committed, and is currently **not** ignored (latent footgun for `git add .`). (3) `.audit-findings-full.md` is the untracked full-evidence log behind the committed `AUDIT_FINDINGS.md`.

**Why it matters:** The harness is finished, on-message documentation (it answers the recurring "why don't Claude.ai chat actions reach DashClaw" question) and a runnable governed tool-loop; leaving it untracked makes it invisible and one `git clean` from deletion. `.dashclaw/` being unignored means a careless `git add .` commits session telemetry and causes cross-machine churn. Both risks are live precisely because `check-ignore` lies about their status.

**Recommended action:** `git add examples/governed-chat-harness` (its `node_modules/` is already ignored and will be skipped) and commit with a `docs(examples):` message — examples are not API routes, so no route/SDK/inventory updates. Append `.dashclaw/` to `.gitignore`. Leave `.audit-findings-full.md` untracked.

**DECISION NEEDED:** Whether to also add `.audit-findings-full.md` to `.gitignore` (prevent accidental commit of the full evidence log) or keep it as a deliberate untracked artifact. Recommend gitignoring it alongside `.dashclaw/`.

**Key files:** `examples/governed-chat-harness/*`, `examples/anthropic-governed-agent/` (sibling reference), `.dashclaw/behavior-samples/2026-06-03.jsonl`, `.gitignore`, `.audit-findings-full.md`

**First step:** `git add examples/governed-chat-harness` then `git status --short examples/governed-chat-harness`; confirm `node_modules/` is absent from staged output. Append `.dashclaw/` (and optionally `.audit-findings-full.md`) to `.gitignore`, then commit.

---

### P1 — Finish the context-namespace teardown: retire the key-points remnant (Python SDK methods + /workspace Context tab) (effort: S)

**Current state:** The namespace is archived (`app/api/_archive/context/` holds `points/`, `threads/`, `threads/[threadId]/`, `threads/[threadId]/entries/`); there is NO live `app/api/context/*`, so every call 404s. The threads retirement was thorough — `sdk/dashclaw.js`, `sdk/README.md`, and the Python client have zero context-thread methods. But two orphaned survivors remain: (a) `app/workspace/page.js` `ContextTab` still fetches the dead routes (`GET /api/context/points` + `/api/context/threads` ~299–300, `GET .../threads/{id}` ~323, `POST .../points` ~343, `POST .../threads` ~368); Context is 1 of 6 tabs (~1182–1187). (b) `sdk-python/dashclaw/client.py` still exposes `capture_key_point` (904), `get_key_points` (908), `get_context_summary` (913), all hitting `/api/context/points`; `sdk-python/README.md` documents all 3 (~534–549). This is an incomplete retirement, not a deliberate points/threads split.

**Why it matters:** A live broken surface — the /workspace Context tab throws "Failed to fetch context data" on load (`Promise.all` rejects on any 404), and the three Python key-point methods 404. It's the #1 coherence gap: the threads half is gone everywhere, leaving a self-contradictory state. Restoring would violate the governance boundary in CLAUDE.md ("minimal governance runtime, not an agent platform... do not extend `_archive`") — key-point capture is agent working-memory tooling, not governance infra.

**Recommended action:** RETIRE, mirroring the threads decision. (1) Remove the `ContextTab` component from `app/workspace/page.js` and drop `'context'` from the tab list/switch (~273–383 and ~1182–1187), leaving the other 5 tabs intact. (2) Delete `capture_key_point`/`get_key_points`/`get_context_summary` from `sdk-python/dashclaw/client.py` and their rows from `sdk-python/README.md`. (3) Update doc/parity surfaces per the SDK checklist (`docs/sdk-parity.md` Python count, `PROJECT_DETAILS.md`, `app/docs/page.js` if listed, reference docs under `plugins/dashclaw/skills` + `public/downloads` via `livingcode:refresh`). (4) Run `npm run sdk:count` and reconcile Python down by 3 (→ 204). (5) Leave `app/api/_archive/context/*` in place (pre-existing dead code). Verify: lint, vitest, build, docs:check, openapi:check, api:inventory:check.

> Note: coordinate with the P0 SDK release — if both ship, the Python count moves 211 → 207 (context-threads) → 204 (key-points). Land them so the CHANGELOG and `release-plan.json` reflect the final number, or sequence the key-points removal into the same `## SDK [4.0.0]` entry.

**DECISION NEEDED:** Confirm RETIRE vs RESTORE. Recommend **RETIRE** (governance-boundary + the asymmetry that threads are already gone). RESTORE is legitimate only if key-points capture is a wanted governance-adjacent memory feature — that path means moving all 4 `_archive/context` routes live, re-adding Node SDK parity (currently zero), and ensuring the backing tables/repository exist.

**Key files:** `app/workspace/page.js`, `sdk-python/dashclaw/client.py`, `sdk-python/README.md`, `docs/sdk-parity.md`, `PROJECT_DETAILS.md`, `app/api/_archive/context/points/route.js`, `app/api/_archive/context/threads/route.js`

**First step:** In `app/workspace/page.js`, remove the `'context'` tab entry and its render line (~1183), then delete the `ContextTab` component (~273–383). Confirm the page builds with the remaining 5 tabs via `npx next build`.

---

### P2 — Low/info audit backlog: 4 risk-grouped commits (one real 500, matcher has both gaps and stale dead entries) (effort: M)

**Current state:** P1–P4 confirmed done. Re-verified remaining low/info items live: (1) **Input validation** — `app/api/usage/costs/route.js:14-19` crashes on a malformed `?period`: `split('-').map(Number)` yields NaN → garbage SQL timestamp literal → **500** (confirmed open). `app/api/analytics/route.js:14` is clamped but `parseInt('abc')=NaN` survives `Math.max(NaN,1)=NaN` → NaN reaches `getAnalytics` (open, lower blast radius). (2) **Matcher (two-sided)** — existing data pages MISSING from `middleware.js` matcher: `analytics`, `agent-spend`, `assumptions`, `my-agent`, `scoring`, `policy-coach`, `labs`, `connect` (page-gate gap); AND stale DEAD entries for pages deleted this/recent sessions still present: `/goals`, `/content`, `/relationships`, `/calendar`, `/tokens` (orphans this session's deletions created). (3) **Env drift** — `.env.example` already documents `AGENT_ONLINE_WINDOW_MS` (224) and `GUARD_LLM_MODEL` (219); MISSING: `DASHCLAW_DISABLE_PROMPT_INJECTION_SCAN`, `NEXT_PUBLIC_APP_URL`/baseUrl, OIDC endpoint overrides (only ISSUER_URL/CLIENT_ID/SECRET/DISPLAY_NAME present), `GOOGLE_AI_KEY`/`GEMINI_MODEL`. (4) `GEMINI.md` (13/188/195/224) says "policy firewall", TypeScript, FastAPI, "Use TypeScript" — repo is JS/Next, no FastAPI. (5) `docs/monetization-plan.md:53` says "23 tools / 6 resources" (canonical **26**). (6) `app/lib/guardrails/generators/{pytest,jest}.js` referenced only by `scripts/check-version-hardcodes.mjs` (a scanner, not a consumer) = dead; `pytest.js` is a TODO stub. (7) `app/lib/notifications.js:18` defaults ALERT sender to a personal gmail (env-overridable). (8) Stale March root docs untouched since March: `PROJECT_CONTEXT.md`, `AI_WORKFLOW.md`, `verify.js`, `verification.py`.

**Why it matters:** Two items are genuine correctness/security issues hiding in the low/info pile: (a) the `usage/costs ?period` 500 is an unvalidated-input crash on a governance endpoint (bad period → 500 instead of 400); (b) matcher page-gate gaps mean dashboards like `agent-spend`/`analytics`/`assumptions`/`my-agent` may not run the auth/redirect middleware every other authenticated page gets — a real access-control surface the audit gates don't catch. The stale matcher entries are dead routing config left by this session's deletions (self-created orphans). The rest is doc-rot — no runtime risk, but it erodes doc trust.

**Recommended action:** Ship as 4 risk-grouped commits, highest-risk first, full gate before each push. **Commit 1 (correctness, +test each):** validate `usage/costs ?period` (reject non-`YYYY-MM` with 400 before building the SQL literal) and harden `analytics ?days` NaN (`Number.isFinite` → default 30); add a route test for each. **Commit 2 (access-control / matcher hygiene):** add the missing existing pages to the matcher (confirm each SHOULD be gated first) AND remove the stale dead entries (`/goals`, `/content`, `/relationships`, `/calendar`, `/tokens`). **Commit 3 (doc drift, zero runtime risk):** `GEMINI.md` (drop TypeScript/FastAPI/"Use TypeScript", fix "policy firewall" → "governance runtime"); `docs/monetization-plan.md:53` 23 → 26; the actually-missing env subset (`DASHCLAW_DISABLE_PROMPT_INJECTION_SCAN`, `NEXT_PUBLIC_APP_URL`, OIDC overrides, `GOOGLE_AI_KEY`/`GEMINI_MODEL`) — skip the two already present. **Commit 4 (dead code + stale docs, operator-gated):** archive/delete the 4 March root docs and the 2 dead guardrail generators — but AUDIT_FINDINGS records these as deliberately "absorbed/tracked," so confirm before deleting.

**DECISION NEEDED:** (1) Which matcher-missing pages SHOULD be auth-gated vs intentionally public — `connect`/`login` are plausibly public; `agent-spend`/`analytics`/`assumptions`/`my-agent`/`scoring`/`policy-coach` look like authenticated dashboards currently ungated. Confirm intent before adding. (2) Delete vs keep the 4 stale March root docs and 2 dead generators — recorded as deliberately "absorbed/tracked," so do not delete without sign-off.

**Key files:** `AUDIT_FINDINGS.md`, `app/api/usage/costs/route.js`, `app/api/analytics/route.js`, `middleware.js`, `.env.example`, `GEMINI.md`, `docs/monetization-plan.md`, `app/lib/notifications.js`, `app/lib/guardrails/generators/{pytest,jest}.js`, `PROJECT_CONTEXT.md`, `AI_WORKFLOW.md`, `verify.js`, `verification.py`

**First step:** Start Commit 1 — add a `/^\d{4}-\d{2}$/` validation on the resolved period in `app/api/usage/costs/route.js` that returns 400 before the date-literal construction, then write a route test asserting `?period=garbage` returns 400 (not 500).

---

### P2 — Iterative policy generator follow-ups: fix compound-request data loss; add the owed UI smoke test (effort: S)

**Current state:** `CustomTab.jsx` renders exactly one draft — `runGenerator` stores all drafts in `genDrafts` but seeds the editable form from `drafts[0]` only (~293), and the editor receives `draft={genDrafts[0] || null}` (~539). No candidate picker (multi-draft components retired this session, commit `d77bde95`). But the system prompt still tells the model to emit multiple drafts ("If the input describes multiple distinct policies, return one draft per policy" — `policy-generator.js:96`), so a compound request silently drops drafts 2..N. `semantic_check` round-trips `instruction`+`action` in guided fields and is advisory-only by design. Tests: `policy-generator.test.js`, `policy-generator-drafts.test.js`, `policy-generate.route.test.js` cover the parser/normalizer/route; `policy-custom-tab.test.jsx` covers only the test-runner/proof/import panels (3 its) — **the generate→refine→save UI loop has zero automated coverage.**

**Why it matters:** Silent data loss on compound requests — "block deploys and protect .env from deletion" prompts the model for two drafts but the UI shows/saves only the first; the second vanishes with no warning, contradicting the generator's "never just says no / always make progress" promise. The missing UI test means a future refactor of the generate/refine/save handlers (state resets, `drafts[0]` seeding, `answerList` mapping) can regress with green CI.

**Recommended action:** (1) Resolve the compound mismatch — cheapest correct fix: change the system prompt to return ONE best draft plus a clarification when it detects multiple intents (drop the "one draft per policy" line at `policy-generator.js:96`), keeping the UI single-draft. As a stopgap regardless, warn when `genDrafts.length > 1` ("Generated N policies; only the first is shown — refine to author them one at a time"). (2) Write the owed UI smoke test (highest-confidence, lowest-risk item). (3) `semantic_check`-advisory and single-draft are fine by design; optionally add one line of copy noting `semantic_check` is advisory-only.

**DECISION NEEDED:** Compound requests — prefer the prompt-level fix (one draft + clarification, keep UI single-draft) or restore a multi-draft picker? Recommend the **prompt fix** (surgical, honest); the picker re-adds a surface intentionally retired this session. Only choose the picker if the operator explicitly wants batch multi-policy authoring.

**Key files:** `app/policies/components/CustomTab.jsx`, `app/lib/policy-generator.js`, `app/policies/lib/policyGeneratorDrafts.js`, `app/policies/components/PolicyGeneratedDraftEditor.jsx`, `__tests__/unit/policy-custom-tab.test.jsx`, `app/api/policies/generate/route.js`

**First step:** Add an "AI generator" describe block to `__tests__/unit/policy-custom-tab.test.jsx` (it mocks fetch by `METHOD url` key — extend the handler map with `POST /api/policies/generate` and `POST /api/policies`): render CustomTab → click "AI generator"; mock generate to return `drafts:[]` + a clarification, assert the chip row + "Refine with my answers" render and no dead-end error; click a chip, click Refine, mock generate to return one valid draft (e.g. `protected_path` with `paths:['.env']`), assert the "Review & save" editor renders; click "Create Policy", assert `POST /api/policies` fired and the panel reset.

---

### P3 — One stale doc count to fix; Stripe scaffolding and remaining "firewall" hits are intentional (effort: S)

**Current state:** (a) "firewall" framing — repo-wide grep returns 9 hits. Only ONE is a live user-facing UI string: `app/components/GuardSimulation.js:183` ("Policy Firewall" homepage animation label, deliberately left). Others: stale March root docs (`PROJECT_CONTEXT.md:9`, `AI_WORKFLOW.md:15+187`, `GEMINI.md:13` — already flagged in AUDIT_FINDINGS D4), two CORRECT literal-firewall uses to leave alone (`hooks/dashclaw_agent_intel/bash_classifier.py:80`, `diagnose.mjs:104`), and audit-log records. (b) Stripe scaffolding — `app/api/billing/checkout/route.js`, `app/api/billing/portal/route.js`, `app/api/webhooks/stripe/route.js` all guard on `STRIPE_SECRET_KEY` (webhook also `STRIPE_WEBHOOK_SECRET`) and return 501 `BILLING_NOT_CONFIGURED` when unset; webhook verifies the Stripe signature before any DB write. Matches `docs/monetization-plan.md` (draft-for-review, "No pricing or checkout surface ships"). Correctly inventoried (billing/* experimental, webhooks/stripe stable). Inert without Stripe env vars. (c) MCP tool count — authoritative **26 tools / 6 resources** (`mcp-server/lib/tools.js` has 26 `dashclaw_*` defs; `resources.js` has 6). Every live user-facing surface already says 26. Only `docs/monetization-plan.md:53` still says "23 tools / 6 resources" (CHANGELOG/desktop-oauth-plan also say 23 but are historical/archival — leave them).

**Why it matters:** Low stakes, cheap correctness. The monetization-plan "23 tools" line is the single internal-doc number contradicting the live count (26) and every shipped surface. The Stripe 501 scaffolding and the GuardSimulation label are deliberate (re-openable monetization path; evocative homepage animation) — touching them is churn against documented decisions.

**Recommended action:** Do ONE thing: edit `docs/monetization-plan.md:53`, "MCP server (23 tools / 6 resources)" → "MCP server (26 tools / 6 resources)". Explicitly DECLINE the rest: leave `GuardSimulation.js:183` "Policy Firewall" and do not chase the stale root docs as positioning work (they belong to the separate AUDIT_FINDINGS D4 archival decision); keep all three Stripe routes as-is (501-when-unconfigured is the documented intentional dormant state). Doc-only edit, no build/test/version impact.

**DECISION NEEDED:** Whether the `GuardSimulation.js:183` "Policy Firewall" UI label should eventually be retagged to "governance runtime" or kept as an intentional evocative animation label. Recommend keeping it. Operator's call only if homepage-animation brand consistency matters.

**Key files:** `docs/monetization-plan.md`, `mcp-server/lib/tools.js`, `mcp-server/lib/resources.js`, `app/components/GuardSimulation.js`, `app/api/billing/{checkout,portal}/route.js`, `app/api/webhooks/stripe/route.js`

**First step:** Edit `docs/monetization-plan.md:53` — replace "MCP server (23 tools / 6 resources)" with "MCP server (26 tools / 6 resources)". That is the only change warranted in this domain.

## Reference

- **`AUDIT_FINDINGS.md`** (committed) — the P1–P4 remediation summary and the low/info backlog source-of-truth.
- **`.audit-findings-full.md`** (untracked, ~173 KB) — full evidence for all 92 audit findings. See P1 above re: whether to gitignore it.
- **`docs/superpowers/specs/2026-06-03-iterative-policy-generator-design.md`** — iterative policy generator spec.
- **`docs/superpowers/plans/2026-06-03-iterative-policy-generator.md`** — iterative policy generator implementation plan.
