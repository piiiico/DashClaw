# NEXT SESSION — post senior-quality pass (2026-06-04)

## State (all pushed to `main`, tree clean)
A gated multi-agent senior-quality pass shipped in 11 commits (`9b3ba958..1ae4e092`): P0 + P1 + P2/P3 fixes, the `learning_velocity`/`learning_curves` unbounded-growth migration (`drizzle/0016`), and a **4.0.1 version bump** (platform + both SDKs unified; `contracts/sdk/release-plan.json` synced).

### THE ONE THING THE OWNER MUST DO
```bash
npm run release:sdks        # publishes Node->npm + Python->PyPI at 4.0.1 (needs your creds)
npm install                 # re-lock to published 4.0.1
npm view dashclaw version   # expect 4.0.1 ; pip index versions dashclaw -> 4.0.1
```
4.0.1 matters because **PyPI 4.0.0 is broken** (Python `_request` 41-site arg inversion — compliance/drift/scoring/learning non-functional). That fix is in HEAD; only the published package is stale.

## REMAINING WORK — docs/skills/marketing/livingcode sweep (this is the to-do)

### 1. SDK method-count reconciliation (do FIRST — drives the rest)
This session changed the public surface:
- **Node: net unchanged at 104** (removed `syncState` -1, added `deleteCapability` +1).
- **Python: 204 -> 203** (removed `sync_state`; `_guard_check` was private/uncounted; `record_assumption` deprecated but still counts).
- MCP tools: **26 unchanged** (the `session_start` change was reverted).
- Routes: **271 unchanged** (no live routes added/removed; retired surfaces were pages or already-archived).

Run `npm run sdk:count` for the authoritative numbers, then grep the repo for the OLD counts and update EVERY surface (per MEMORY.md "SDK Documentation Checklist"):
`app/docs/page.js`, `sdk/README.md`, `sdk-python/README.md`, `docs/sdk-parity.md`, `docs/sdk-reference.md`, `PROJECT_DETAILS.md`, `app/downloads/page.js`. Grep `204` and `104` repo-wide before assuming you got them all.

### 2. Document the new/changed SDK surface
- **ADD** `deleteCapability(capabilityId)` (Node, DELETE /api/capabilities/:id) to `app/docs/page.js`, `sdk/README.md`, `docs/sdk-parity.md`.
- **REMOVE** `syncState`/`sync_state` from all docs (retired; archived `/api/sync`).
- Note SSE now sends `Authorization: Bearer` (Node + Python) when `authToken`/`auth_token` set.
- Note `scoreWithProfile`/`batchScoreWithProfile` now throw `TypeError` on wrong shape.
- Python `record_assumption` deprecated -> `register_assumption`.
- Legacy v1 context methods (`captureKeyPoint` etc.) now warn (retired endpoints).

### 3. CHANGELOG.md
Add a **4.0.1** entry. Summarize: Python `_request` 41-site fix (critical); Node SSE bearer + CJS namespace/instanceof bridge + `deleteCapability` + `syncState` removal; backend route hardening (redactAny dedup, 400-on-bad-JSON, apiErrorResponse); compliance evidence nesting; telegram key reconcile; retired orphan pages (`/notifications`, `/bug-hunter`, `/workspace`) + memory-health widget; orphan pages linked into nav (`/team /swarm /my-agent /dashboard`); learning-analytics unbounded-growth migration; numerous P2/P3 type-safety/dedup/hex-token cleanups.

### 4. livingcode + skills + plugin + connector
- Run `npm run livingcode:refresh` and confirm clean (the pre-commit hook ran it per-commit, but do a full pass + commit any drift). This regenerates `app/lib/doctor/generated/*`, `public/livingcode/index.html`, the platform-intelligence snapshot + zips, and the `dashclaw-platform-intelligence` SKILL.md + references (api-surface.md, platform-knowledge.md) across website/global/project/plugin copies.
- Verify the **skills** reflect reality: `plugins/dashclaw/skills/dashclaw-platform-intelligence/references/*` and `dashclaw-governance/SKILL.md` — method counts, the retired surfaces, the 26 MCP tools.
- **Plugin**: `plugins/dashclaw/.claude-plugin/plugin.json` keeps its OWN version (not in the sync check) — bump only if you consider this a plugin release.
- **Connector/MCP**: `mcp-server/lib/server.js` now reads its version from `mcp-server/package.json` (no longer hardcoded). Confirm `mcp-server/package.json` version is what you want advertised. The OAuth connector / desktop-plugin spec under `docs/superpowers/specs/` is unaffected.

### 5. Marketing site (in-app; there is NO separate repo)
`app/page.js`, `app/landingData.js`, `app/docs/page.js`, `app/downloads/page.js`. Version strings are injected via `next.config.js` (auto — don't hardcode). Check for: stale method counts, any feature copy referencing the retired `/notifications`/`/workspace`/`/bug-hunter` surfaces, and that `deleteCapability` / nav additions are reflected if surfaces are listed. **Read `.impeccable.md` before any copy/visual change; use CSS tokens, never hex.**

### 6. Verify everything
```bash
npm run sdk:count && npm run docs:check && npm run openapi:check && npm run api:inventory:check \
  && npm run version:sync:check && npm run lint && npx vitest run && npx next build
```
Regenerate contracts if routes/docs changed: `npm run openapi:generate`, `npm run api:inventory:generate`.

## Deferred (with reasons) — NOT bugs, your call later
- `middleware-dead-isprotectedroute` (P3) — reverted; removing the always-true var forces block de-indentation in the auth path + the agent caused line-ending churn. Cosmetic.
- `integration-health` timing-safe dedup + `mcp session_start` agentId(input) — reverted; both fixes are arguably correct but their tests couple to the original behavior (need coordinated test updates).
- `actions-repo-dual-path-mock-compat` (P2, L) — ~130 lines of test-mock-compat in production; needs a real sqlMock adapter.

## Reverted as FALSE POSITIVES (don't re-flag — see memory `reference_dashclaw_audit_false_positives`)
`/api/actions/*` "dead routes" (next.config rewrites), compliance "SQL injection" (parameterized tagged template), workflow+prompts admin-headers (middleware server-derives `x-org-role`), guard-decisions-path x2 (both routes validly list decisions).

## Informational — the 3 originally-reported MCP bugs
`loop_list` 500 and `learning_query` 500 are **already fixed in HEAD**; `agent_id->claude-desktop` is documented design (multi-agent attribution gap). If you still see them live, your **installed MCP server/CLI is stale → reinstall**.
