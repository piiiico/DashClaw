# Overnight Cleanup Report

Branch: `overnight/cleanup-2026-06-01`
Started: 2026-06-01
Package: `dashclaw-platform@2.18.0`

This report is updated continuously. Every claim below maps to a real commit on
this branch. Nothing here is fabricated; counts and outputs are recorded from
commands that actually ran.

## Summary counts

| Category | Count |
|---|---|
| Known bugs fixed | 2 fixed + 1 already-fixed (regression coverage added) |
| Other logic errors fixed | 3 (in progress; 11 confirmed, working the queue) |
| Tests added/strengthened | ~17 cases across 6 files |
| Docs/examples fixed | resource count across 6 files; others verified accurate |
| Safe cleanups | 0 (pending) |
| Reverted | 1 (learning route q/limit, see bug 2 note) |
| Left untouched (logged as proposals) | 3 + 2 refuted findings |

## Baseline (recorded before any change)

Commands taken from `package.json` scripts and `.github/workflows/ci.yml`.

| Command | Result |
|---|---|
| `npm run lint` (`eslint .`) | Clean, no errors |
| `npx vitest run` | 269 files passed, 1 skipped (270 total); 2236 tests passed, 5 skipped (2241 total); ~24s |
| `npm run build` (`next build`) | Success, exit 0 |

The full CI pipeline also runs `docs:check`, `openapi:check`,
`api:inventory:check`, `route-sql:check`, `version:check`, `contracts:check`,
`reliability:ws1:check`, `security-scan.js`, `sdk:integration`, and
`sdk:integration:python`. These are validated per-change as relevant.

## Known bugs (from the MCP smoke test: 18 of 21 endpoints passing)

### 1. loop_list (`dashclaw_loop_list` -> GET /api/actions/loops)

Status: FIXED in commit 80e170cf.

Root cause: the COUNT query in `app/api/actions/loops/route.js` is built as
`SELECT COUNT(*) FROM open_loops ol ${where}` with no join to `action_records`,
but the `where` clause references `ar.agent_id` whenever an `agent_id` filter is
supplied. Postgres then errors with "missing FROM-clause entry for table ar",
the `Promise.all` rejects, and the route returns HTTP 500. The MCP server always
injects the configured `agent_id` (commit 61d3be25 made server identity
authoritative), so `dashclaw_loop_list` triggers the broken count path on every
call.

Fix: mirror the main query's `LEFT JOIN action_records ar` in the count query.
The join cannot multiply rows (one action_record per action_id per org), so
COUNT is unchanged for the unfiltered case. Regression test
`__tests__/unit/actions-loops.route.test.js` reproduces the 500 by simulating
Postgres rejecting `ar.*` references without the join (verified red before the
fix, green after).

### 2. learning_query (`dashclaw_learning_query` -> GET /api/learning/lessons)

Status: FIXED in commit ddf26140.

Root cause: `dashclaw_learning_log` writes decisions to `POST /api/learning`
(the `decisions` table), but `dashclaw_learning_query` read from
`/api/learning/lessons`, which is the recommendations consolidator
(`learning_recommendations` + `drift_alerts`). Those are different stores, so a
logged decision could never be queried back. The handler also sent `q=<query>`,
which `/api/learning/lessons` ignores entirely. The tool advertises a search
param that "matches decision/context", but recommendations have no
decision/context text to match.

Fix: repoint the handler at `GET /api/learning` so log and query share one
store. The `query` search and `limit` are applied client-side, because
`GET /api/learning` does not accept them server-side. The search window is
therefore the server's most-recent decisions for the agent.

Reverted: an earlier attempt added server-side `q`/`limit` to
`GET /api/learning` via `sql.query`. That increased direct route-level SQL and
the CI-gated `route-sql:check` guardrail blocked it. Reverted in favor of the
client-side approach (no new SQL, no contract change). A server-side `q`/`limit`
is logged as a proposal below.

### 3. agent_id override behavior

Status: already resolved by commit 61d3be25 ("server agent_id config wins over
LLM tool input"), which flipped the precedence in `mcp-server/lib/tools.js`
from `input.agent_id || client.agentId` to `client.agentId || input.agent_id`.
That commit also added unit tests for `dashclaw_guard`. The smoke-test symptom
the goal describes ("smoke test the MCP server fully" attributing actions to
"claude-mcp-smoketest") is the exact scenario that commit fixed.

Action taken (commit 2249a625): added regression coverage locking the override
across the toolkit handlers (loop_list, learning_query, decisions_recent,
secret_list, handoff_create) plus the bare-server fallback path, not just guard.
Verified by flipping the precedence: the new test and the existing guard test
both fail under the old ordering, both pass under the fixed ordering.

## Logic errors

Found by a read-only discovery pass (6 parallel finders across middleware/auth,
core governance routes, core lib, execution/finality, the Node SDK, and
auxiliary routes), each finding then adversarially re-verified to refute
unreachable or contract-breaking candidates. 11 confirmed; I re-verified each
against the code before fixing. Every fix is behavior-preserving with a
regression test proven red before and green after.

| # | Area | Issue | Status |
|---|---|---|---|
| 1 | code-sessions | `runFinalize` read session fields off `detail.*` but `getSessionDetail` returns `{ session, messages, toolUses }`, so live-session optimizer/alerts ran on zeroed cost/tokens (silent) | FIXED 174e0de2 |
| 2 | Node SDK | `_request` serialized `{ status: undefined }` as the literal `status=undefined`, emptying filtered list results (regression from v1) | FIXED 354fad31 |
| 5 | learning analytics | non-numeric `?limit=` produced `LIMIT NaN` and 500'd velocity/curves GET | FIXED b2de6d17 |
| 3 | execution-finality | workflow execute wrote the final outcome ungated, clobbering an operator cancel that landed mid-run | queued |
| 6 | execution-finality | workflow resume route lacked the try/catch the execute route has, leaving the parent action stuck `running` on a throw | queued |
| 4 | core routes | a literal `null` JSON body crashed validated POST routes with 500 instead of the intended 400 | queued |
| 7 | Node SDK | `_request` called `res.json()` unconditionally, so a non-JSON error body (502/504/413/429) threw a SyntaxError and lost the real status | queued |
| 8 | Node SDK | `waitForApproval` returned a different object shape from the SSE fast-path vs the polling fallback | queued |
| 10 | middleware | auth/rate-limit error responses omitted the CORS headers their matching success responses set | queued |
| 11 | core routes | outcome route emitted ACTION_UPDATED with no `action` key, so the SSE frame for terminal outcomes was `data: null` | under review |

Refuted or uncertain (not fixed): a non-Error workflow throw (not reachable in
the current call graph), and the legacy outcome-mapping note (a duplicate of #3's
mechanism). Two more, real but requiring auth/status-code changes, are logged as
proposals below rather than executed unsupervised.

## Tests added or strengthened

- `__tests__/unit/actions-loops.route.test.js` (new, 3) — loop_list 500 regression
- `__tests__/unit/learning.route.test.js` (new, 3) — first coverage for GET /api/learning
- `__tests__/unit/mcp-tools-toolkit.test.js` (+5) — learning_query store/search + agent_id override lock
- `__tests__/integration/code-sessions/ingest-live.route.test.js` (mock corrected + session-flow assertions)
- `__tests__/unit/sdk-v2.test.js` (+1) — query-param undefined/null filtering
- `__tests__/unit/learning-analytics.test.js` (+3) — limit NaN guard

## Docs and examples fixed

- MCP resource count corrected from 4 to 6 across sdk/README, sdk-python/README,
  the platform-intelligence reference docs (livingcode source), and the
  managed-agent-mcp + examples READMEs. Verified the actual count is 6
  (`policies`, `capabilities`, `agent/{id}/history`, `status`,
  `code-sessions/projects`, `code-sessions/sessions/{id}`). CHANGELOG and
  historical plans left as-is (they record the v2.12 launch state).
- Verified accurate (no change needed): README route counts
  (259 / 46 stable / 24 beta / 189 experimental match the inventory); the
  flagship examples (first-governed-action.js, guard-and-act.js,
  loop-monitoring.js) match the real SDK methods and `guard()` return shape.

## Safe cleanups

(none yet)

## Reverted or left untouched

(none yet)

## Proposals (not executed, for review)

### SECURITY: `/api/prompts` bare prefix in PUBLIC_ROUTES over-exposes org data

`middleware.js` PUBLIC_ROUTES contains the bare prefix `/api/prompts`, and the
gate is `pathname.startsWith(route)`. The intent (per the inline comment and the
demo-mode re-pass list) was to expose only the static raw-markdown prompt
endpoints (`/api/prompts/server-setup/raw`, `/api/prompts/agent-connect/raw`)
for the public "Copy Prompt" buttons. But the bare prefix also makes the
org-scoped management endpoints unauthenticated: `GET /api/prompts/templates`,
`/api/prompts/runs`, `/api/prompts/stats` return org data with no API key
(falling back to `org_default`), and `POST /api/prompts/render` with
`record:true` performs an unauthenticated write to `org_default`. The
templates POST/PATCH/DELETE are saved only by their own `getOrgRole` admin
self-gates; GET and render have none.

Recommended remediation: replace the bare `/api/prompts` entry with the
specific raw endpoints that must stay public
(`/api/prompts/server-setup/raw`, `/api/prompts/agent-connect/raw`, and
`/api/prompts/sdk-coverage/raw` if it exists). NOT executed here because it
changes auth behavior (those paths flip from 200 to 401 without a key), which
the operating rules say to surface as a proposal rather than apply unsupervised.
This is the highest-priority item in this report.

### Closed-session PATCH returns a contradictory 404

`updateSession` filters `WHERE ... AND status != 'closed'`, so a PATCH to an
existing-but-closed session matches zero rows and the route returns 404
'Session not found' even though GET still returns that session. A correct fix
returns 409 (or keeps 404 with an accurate message), but either changes a public
status code or response body, so it is logged here rather than applied.

### Server-side q/limit on GET /api/learning

`dashclaw_learning_query` now filters search text and limit client-side over
the server's most-recent decisions. To search the full decision history, add
`q` (ILIKE on decision/context) and `limit` to `GET /api/learning`
server-side. The route-sql guardrail blocks new direct SQL in route files, so
this needs a small repository extraction: add a `listDecisions(sql, orgId,
{ agentId, q, limit })` function to a learning repository and call it from the
route (the route's direct-SQL count would then drop, not rise). Low risk, but
it touches a route plus a new repository function and should be DB-verified.

## Big refactor proposals (not executed)

To be written: middleware.js split and TypeScript migration, with risk
assessment for each.
