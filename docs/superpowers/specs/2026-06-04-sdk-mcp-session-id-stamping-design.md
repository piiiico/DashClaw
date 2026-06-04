# SDK/MCP `session_id` Stamping — Design

**Date:** 2026-06-04
**Status:** Approved (design); ready for implementation plan
**Scope:** Client-side only. No new routes, SDK methods, MCP tools, schema columns, or migrations.

## Problem

`action_records.session_id` exists and the platform already accepts it end-to-end:

- `app/lib/validate.js:66` whitelists `session_id` (string, maxLength 128).
- `app/api/actions/route.js:250` passes the validated body straight to `createActionRecord`.
- `app/lib/repositories/actions.repository.js:256,292` writes `data.session_id || null`.
- `app/lib/sessions.js:9–15` aggregates per session by **unioning** two paths: a **Direct** path (`action_records.session_id = session.id`) and a time-window **Fallback** (same `agent_id`, `created_at` inside the session lifetime). The code comment explicitly anticipates this work: "currently none in the platform, but the column is wired so SDK/MCP stamping can light this up without a query change."

Today no client stamps `session_id`, so every session→action link rides the Fallback. The Fallback is correct but approximate — it cannot distinguish two agents sharing a session window, and it attributes by time rather than by identity. This work lights up the Direct path so linkage is **exact** wherever a client knows its session.

## Decision: hybrid, per-surface

The stamping model differs by surface because the calling context differs:

- **MCP** callers are LLMs that will not reliably re-thread a session id into every `dashclaw_record` call → **ambient auto-stamp** from the session started in the same connection, with an explicit override.
- **SDK** callers are deterministic programs that can thread the id explicitly → **first-class explicit param**, no ambient client state (which would risk cross-contamination on a long-lived client shared across concurrent tasks/threads).

## Surface 1 — MCP (`mcp-server/lib/tools.js`)

One tool source feeds **both** transports:

- **stdio** (`mcp-server/lib/server.js:53`) calls `createToolHandlers(client)` **once at startup** → closure lives for the whole process.
- **HTTP** (`app/api/mcp/route.js:80`) calls it **inside `POST`** → a fresh closure per request, and one warm serverless instance may serve many orgs.

Therefore ambient state **must live inside the `createToolHandlers(client)` closure (tools.js:448), never module-global** — module-global state would leak one org's session id onto another org's record on the HTTP path.

Changes:

1. Add optional `session_id` (string) to the `dashclaw_record` `inputSchema`, described as defaulting to the session from `dashclaw_session_start` in this connection.
2. Inside `createToolHandlers(client)`: `let activeSessionId = null;`.
3. `dashclaw_session_start`: on success, `activeSessionId = result?.session?.id ?? activeSessionId;` (the `POST /api/sessions` response is `{ session }`, per `app/api/sessions/route.js:23`).
4. `dashclaw_record` body: `session_id: input.session_id ?? activeSessionId`.
5. `dashclaw_session_end`: clear `activeSessionId` **only if** it equals `input.session_id`, so ending an unrelated session does not wipe the active one.

Behavior by transport:

- **stdio:** start a session once; every subsequent `dashclaw_record` is auto-linked; an explicit `session_id` overrides; `session_end` clears it.
- **HTTP:** ambient is `null` on each fresh request (no carry-over, no leak); the explicit `session_id` param plus the tool description carry the id. No regression versus today.

## Surface 2 — Node SDK (`sdk/dashclaw.js`)

`createAction(action)` already forwards `action.session_id` via `...action`. Make it **first-class**: document `session_id` in the method's JSDoc/typedef. No behavior change — passthrough already works. Action fields are snake_case on the wire, so the field stays `session_id` (not `sessionId`). No ambient "current session" state.

## Surface 3 — Python SDK (`sdk-python/dashclaw/client.py`)

`create_action(action_type, declared_goal, **kwargs)` already forwards `session_id` via `**kwargs`. Make it **first-class**: add an explicit `session_id: str = None` parameter, included in the payload only when provided. Backward compatible (old kwarg callers and omitting callers both keep working).

## Non-goals (YAGNI)

- No ambient "current session" state in either SDK.
- No persistence of an "active session" for the HTTP MCP transport (explicit param covers it).
- No new SDK method, MCP tool, route, schema column, or migration.
- `session_id` is not set on `updateOutcome`/PATCH — it belongs to the record at create time.

## Edge cases (all degrade gracefully)

- **record before any `session_start`:** `activeSessionId` is null → `session_id` omitted/null → existing Fallback applies. No regression.
- **unknown/bad id:** `session_id` is plain TEXT with no FK; the Direct join simply matches nothing and the Fallback still applies. No 500. `validate.js` caps length at 128.
- **double `session_start` (stdio):** latest wins (`activeSessionId` overwritten).
- **`session_end` for a different id:** guarded equality check leaves the active session intact.

## Testing

- **MCP** (`__tests__/unit/mcp-tools*.test.js`): `session_start` sets active → next `record` posts that `session_id`; explicit `session_id` overrides ambient; `record` without a start omits it; `session_end` clears only on id match; `inputSchema` includes `session_id`.
- **Node SDK:** `createAction` forwards `session_id`.
- **Python SDK:** `create_action(session_id=…)` includes it; omitted when `None`.
- **Gate:** `npm run lint` + full `npx vitest run`. Build/livingcode regen happens via the pre-commit hook (the MCP tool schema feeds the livingcode emitter).

## Docs & release

- No new method or tool → `npm run sdk:count` (104 Node / 203 Python) and the MCP tool count (26) are **unchanged**; no count reconciliation.
- Document the new param/field on: `app/docs/page.js`, `sdk/README.md`, `sdk-python/README.md`, `mcp-server/README.md`, and `PROJECT_DETAILS.md` if it lists record params.
- Additive and backward-compatible → **patch** bump. Platform + both SDKs share one version (currently 4.1.0); bump together via `npm run version:set`. `mcp-server/package.json` carries its own manifest version (not in the sync check) and is bumped alongside since its tool surface changed.
- SDK publish (`npm run release:sdks`) is the owner's step.
