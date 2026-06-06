SUPERGOAL_PHASE_START
Phase: 8 of 14 — API route conversion [INTEGRATION GATE]
Task: Convert 242 active routes to TS in 12 non-overlapping domain groups (archived excluded), preserving status codes, middleware, shared identity/error helpers.
Type: brownfield, refactor
Mandatory commands: npm run typecheck, npm run lint, npm run route-sql:check, npm run api:inventory:check, npm run openapi:check, npx vitest run, npx next build
Acceptance criteria: 6
Evidence required: route-sql:check exit 0, api-inventory/openapi exit 0, identity-resolver grep, vitest + build summary
Depends on phases: 2, 3, 5, 7
Cleanliness override: converting routes that retain existing `console.error`; NO net-new debug prints.

## Why
Routes are the public surface. Preserve status codes + response shapes; converge all action-creating routes on the typed identity resolver. EXCLUDE `app/api/_archive/**` (48 files). 12 NON-OVERLAPPING worker groups.

## Work
- See ROADMAP.md "Phase 8" for the 12 route groups + counts. Authoritative: spec §15.
- Per route: type request parsing; validate body/query/headers/path (Zod from Phase 3); resolve org+role + agent identity via shared helpers; type responses; shared API error contract; preserve status codes + middleware expectations; reject invalid state before persistence; add regression coverage.
- Route generators are TS-aware from Phase 1 — confirm they still discover every route.
- Do NOT convert or refactor `app/api/_archive/**`. Do NOT increase the 9 preexisting `sql.query()`-in-route count.

## Acceptance criteria (all must pass — verify each in transcript)
- `npm run typecheck` + `npm run lint` clean
- `npm run route-sql:check` exit 0 (no NEW direct SQL; preexisting count not increased)
- `npm run api:inventory:check` + `npm run openapi:check` exit 0 (all routes still discovered)
- Public status codes + response shapes preserved (compat tests pass)
- All action-creating routes use the typed `resolveAgentIdentity` (grep)
- Full gate: `npx vitest run` green AND `npx next build` green

## Mandatory commands (run each, surface last ~10 lines + exit code)
- npm run typecheck
- npm run lint
- npm run route-sql:check
- npm run api:inventory:check
- npm run openapi:check
- npx vitest run
- npx next build

## Evidence required in transcript
- route-sql:check exit 0; api-inventory + openapi exit 0; identity-resolver grep; vitest + build summary

## Notes
Dispatch via Ultracode workflow: one agent per route group, NON-OVERLAPPING. `_archive` is a documented JS exception — never touched.
