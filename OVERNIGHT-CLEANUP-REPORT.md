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
| Other logic errors fixed | 0 (in progress) |
| Tests added | 11 (3 loop_list, 5 learning, 3 agent_id override) |
| Docs/examples fixed | 0 |
| Safe cleanups | 0 |
| Reverted | 1 (learning route q/limit, see bug 2 note) |
| Left untouched (logged) | 0 |

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

## Logic errors fixed

(none yet)

## Tests added

(none yet)

## Docs and examples fixed

(none yet)

## Safe cleanups

(none yet)

## Reverted or left untouched

(none yet)

## Proposals (not executed, for review)

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
