SUPERGOAL_PHASE_START
Phase: 7 of 14 — Database repository conversion [INTEGRATION GATE]
Task: Convert 49 repositories to TS in 7 non-overlapping ownership groups, preserving org_id scoping, parameterized SQL, idempotency, nullable + numeric-string semantics.
Type: brownfield, refactor
Mandatory commands: npm run typecheck, npm run lint, npx vitest run, npm run route-sql:check, npx next build
Acceptance criteria: 6
Evidence required: org_id grep per group, numeric-coercion spot check, vitest + build summary
Depends on phases: 2, 3, 5
Cleanliness override: converting repos that retain existing `console.error` in catch blocks; NO net-new debug prints.

## Why
Repositories are the SQL-owning layer (route-sql guard). Convert in dependency order; treat DB rows as untrusted until mapped. 7 NON-OVERLAPPING worker ownership groups (dispatch via Ultracode workflow with explicit per-agent file ownership).

## Work
- See ROADMAP.md "Phase 7" for the 7 ownership groups (Core Execution; Agent Identity/Presence/Trust; Governance/Policies/Guardrails; Config/Secrets/Integration; Knowledge/Learning/Content; Capabilities/Permissions/Marketplace; Analytics/Monitoring/FinOps). Authoritative: spec §14.
- Per repo: type inputs/outputs, define row types, mapping functions, parse JSON columns safely, preserve `WHERE org_id` filters, parameterized SQL, idempotency, concurrency, nullable values, Neon `numeric`→`Number()` coercion, `real`→number; no unsafe assertions; preserve Neon + direct-postgres compat; preserve route-sql guard behavior.
- Workers edit ONLY their group's files. Parent owns shared row/db types (from Phase 2). guard/jti repos already done in Phase 5; finops in Phase 4.

## Acceptance criteria (all must pass — verify each in transcript)
- `npm run typecheck` + `npm run lint` clean
- Every converted repo preserves `WHERE org_id = ${orgId}` on tenant-owned queries (grep-verified per group)
- Neon `numeric` aggregates coerced via `Number()` before arithmetic (no string-concat NaN regressions) — spot check
- `npm run route-sql:check` exit 0
- Full gate: `npx vitest run` green AND `npx next build` green
- No unguarded `JSON.parse` left in converted repos

## Mandatory commands (run each, surface last ~10 lines + exit code)
- npm run typecheck
- npm run lint
- npx vitest run
- npm run route-sql:check
- npx next build

## Evidence required in transcript
- per-group org_id grep; numeric-coercion spot check; route-sql:check exit 0; vitest + build summary

## Notes
Dispatch conversion via an Ultracode workflow: one agent per ownership group, NON-OVERLAPPING files, worker instruction per spec §21.2. Inspect every result before integration.
