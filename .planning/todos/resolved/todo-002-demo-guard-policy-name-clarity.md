---
id: todo-002
title: Rename "Demo Production Guard" to signal sandbox origin
created: 2026-04-22
area: Demo middleware
severity: low
type: clarity / UX
source_conversation: 2026-04-22 diagnosis session — "Demo Production Guard" message was mistaken for a real policy match
---

## Problem

`app/lib/demo/demoMiddleware.js:624` returns a catch-all block for any unknown agent with `risk_score >= 75`:

```js
matched_policies: shouldBlock ? ['Demo Production Guard'] : [],
reason: 'High-risk production action requires explicit approval per Demo Policy.'
```

The string `"Demo Production Guard"` is indistinguishable from a real user-defined policy at first glance. When a user accidentally points real agent traffic at the demo instance, the block appears to be a legitimate governance decision — leading to confused debugging (the user in this case deleted all real policies from their Vercel UI trying to clear the block).

## Proposed fix

Change the hardcoded policy label to something unambiguously sandbox-flavored:

Current: `"Demo Production Guard"`
Options:
- `"demo-sandbox:high-risk-auto-block"` — namespaced, machine-readable
- `"SANDBOX_MODE_AUTO_BLOCK"` — screams "not your policy"
- `"[Demo fixture] Unknown-agent high-risk auto-block"` — human-readable warning

Also: update the `reason` field to call out demo-mode:
- Current: `"High-risk production action requires explicit approval per Demo Policy."`
- Better: `"[Demo mode] Unknown agent at risk_score {N} auto-blocked by sandbox fixture. This is not a real policy decision — set DASHCLAW_BASE_URL to a non-demo instance."`

## Files

- `app/lib/demo/demoMiddleware.js:130, 136, 625, 635` — all three locations
- `graphify-pilot/app/lib/demo/demoMiddleware.js:132, 569` — stale snapshot, lower priority

## Related

- todo-001 (hook warns on demo mode) — same root cause surface
- Complements D-20 from `02-CONTEXT.md` (screencast): a clear demo-mode signal prevents the screencast from accidentally being recorded against fixtures

## Acceptance

- [ ] Hardcoded policy name in `demoMiddleware.js` no longer reads like a real policy
- [ ] Reason string in demo-mode blocks explicitly calls out sandbox origin
- [ ] Test: curl localhost:3000/api/guard (demo instance) with unknown agent + high risk — response body makes it obvious the block is a fixture

## Notes

Low-severity because the existing label was designed before the hook-dogfood pattern existed — it made sense when demos were UI-only. Now that real agents can route to it by accident, the ambiguity is a real cost.
