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
| Known bugs fixed | 0 (in progress) |
| Other logic errors fixed | 0 |
| Tests added | 0 |
| Docs/examples fixed | 0 |
| Safe cleanups | 0 |
| Reverted | 0 |
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

Status: in progress.

Root cause: the COUNT query in `app/api/actions/loops/route.js` is built as
`SELECT COUNT(*) FROM open_loops ol ${where}` with no join to `action_records`,
but the `where` clause references `ar.agent_id` whenever an `agent_id` filter is
supplied. Postgres then errors with "missing FROM-clause entry for table ar",
the `Promise.all` rejects, and the route returns HTTP 500. The MCP server always
injects the configured `agent_id` (commit 61d3be25 made server identity
authoritative), so `dashclaw_loop_list` triggers the broken count path on every
call.

### 2. learning_query (`dashclaw_learning_query` -> GET /api/learning/lessons)

Status: in progress.

Root cause: `dashclaw_learning_log` writes decisions to `POST /api/learning`
(the `decisions` table), but `dashclaw_learning_query` reads from
`/api/learning/lessons`, which is the recommendations consolidator
(`learning_recommendations` + `drift_alerts`). Those are different stores, so a
logged decision can never be queried back. The handler also sends `q=<query>`,
which `/api/learning/lessons` ignores entirely. The tool advertises a search
param that "matches decision/context", but recommendations have no
decision/context text to match. The query param is a no-op against the wrong
store.

### 3. agent_id override behavior

Status: already resolved by commit 61d3be25 ("server agent_id config wins over
LLM tool input"), which flipped the precedence in `mcp-server/lib/tools.js`
from `input.agent_id || client.agentId` to `client.agentId || input.agent_id`.
That commit also added unit tests for `dashclaw_guard`. Plan: add regression
coverage that locks the override across the toolkit handlers (loop_list,
learning_query, decisions_recent, secret_list, handoff_create), not just guard,
so a future refactor cannot reintroduce the spoofing path in one handler.

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

## Big refactor proposals (not executed)

To be written: middleware.js split and TypeScript migration, with risk
assessment for each.
