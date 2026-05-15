---
id: todo-001
title: Hook warns at startup if BASE_URL points to a demo-mode instance
created: 2026-04-22
area: Claude Code integration (Phase 2)
severity: medium
type: hardening
source_conversation: 2026-04-22 diagnosis session — hook silently routed to localhost:3000 demo container for ~30 minutes due to stale DASHCLAW_BASE_URL env var
---

## Problem

A stale `DASHCLAW_BASE_URL` in the shell environment silently redirected real Claude Code agent traffic to a local `dashclaw-demo` Docker container running in `DASHCLAW_MODE=demo`. The demo middleware returned hardcoded `decision: "block"` for unknown agents with `risk_score >= 75`, which looked indistinguishable from a real policy block — the error message said `Policy: Demo Production Guard`, which sounds like a real policy name.

Diagnosis required:
- Searching the codebase for "Demo Production Guard"
- Discovering it's only defined in `app/lib/demo/demoMiddleware.js:624`
- Running a diagnostic wrapper around `api_request` to reveal the actual URL (`http://localhost:3000`) vs what `.env` said (`https://my-dashclaw.vercel.app`)

Total debug time: ~20–30 minutes. A one-line startup check would have surfaced the mismatch immediately.

## Proposed fix

In `hooks/dashclaw_pretool.py` (and the installed copy in `.claude/hooks/`), add a one-shot health check at hook startup:

1. `GET {BASE_URL}/api/health` with a tight timeout (e.g. 500ms, cached for N minutes via a tempfile flag to avoid per-invocation cost)
2. If response body contains `"mode": "demo"` or the origin matches a demo fixture signature, print a prominent warning to stderr:
   ```
   [DashClaw] ⚠ DASHCLAW_BASE_URL points to a demo-mode instance ({url}).
            Governance decisions will come from fixture data, not your real policies.
            Set DASHCLAW_BASE_URL to your real instance to dogfood properly.
   ```
3. Do NOT block enforcement on this — just surface it.

Alternative: inspect the first guard response for `"org_id": "org_demo"` and warn post-hoc.

## Files

- `hooks/dashclaw_pretool.py` — add startup check in `main()` or `api_request`
- `.claude/hooks/dashclaw_pretool.py` — keep in sync (or make install-hooks script re-copy from canonical)
- `app/api/health/route.js` — ensure `mode` is included in the health payload (check current response)

## Related

- `feedback_deploy_flow.md` — zero-friction deploy preference
- CCI-01 (Phase 2 SPEC): 5-minute install-to-first-approval — silent misrouting breaks this
- Supports DOG-01 (dogfood evidence): real dogfood requires hitting the real instance

## Acceptance

- [ ] Hook prints a visible warning when `/api/health` reports demo mode
- [ ] Warning does not block enforcement (opt-in clarity, not gating)
- [ ] Health check is cached to avoid per-invocation latency
- [ ] Test: export DASHCLAW_BASE_URL=http://localhost:3000 (demo container running), trigger a governed command, confirm warning appears
