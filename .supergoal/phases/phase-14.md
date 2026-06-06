SUPERGOAL_PHASE_START
Phase: 14 of 14 — Polish, Harden, Docs & Final report
Task: Enforce the full completion gate, accurate TS-architecture docs, and the spec §25 final migration report.
Type: brownfield, refactor, ui
Mandatory commands: npm run typecheck, npm run lint, npx vitest run, npx next build, npm run docs:check, npm run contracts:check, npm run openapi:check, npm run api:inventory:check, npm run route-sql:check, npm run version:sync:check, npm run sdk:integration, npm run sdk:integration:python, npm run scripts:check-syntax
Acceptance criteria: 8
Evidence required: every gate command exit code + last lines, final report, /spend/code screenshot, exceptions list, repo-state added-lines cleanliness counts
Depends on phases: 1-13

## Why
"Every aspect is perfect" gets enforced here: the full gate, harden sub-passes, accurate docs, and the complete final report (spec §23–§25).

## Work
- See ROADMAP.md "Phase 14". Authoritative: spec §23 (verification matrix), §24 (completion criteria), §25 (final report fields).
- Harden sub-passes (each produces a paragraph of evidence): UX & copy; states; edges (money/nullable/long inputs); security (boundary validation, no client-bundle secrets, tenant-isolation grep); a11y (converted pages unchanged); perf (no new N+1 / bundle bloat); diff review via `bash .supergoal/repo-state.sh added-lines <baseline>` for stray debug logs / session TODOs / dead imports; regression sweep (full gate).
- Docs: run the `dashclaw-ship` accuracy sweep so every derived surface reflects the TS architecture; `version:sync:check` green; describe the TS architecture in docs.
- Write `.supergoal/FINAL-MIGRATION-REPORT.md` with EVERY spec §25 field (baseline + version, baseline command results, preexisting failures, files converted, intentional JS/MJS exceptions, shared types, runtime schemas, architecture/identity/audit/pricing/FinOps/x402 changes, money+currency decisions, DB mapping decisions, tests added, all commands run + results, public/DB/SDK compat implications, remaining suppressions, remaining risks, deferred work, follow-up milestones).

## Acceptance criteria (all must pass — verify each in transcript)
- `npm run typecheck` 0 errors
- `npm run lint` clean
- `npx vitest run` green (count ≥ baseline 2846 + Phase 11 additions)
- `npx next build` green
- `npm run docs:check`, `contracts:check`, `openapi:check`, `api:inventory:check`, `route-sql:check`, `version:sync:check`, `sdk:integration`, `sdk:integration:python`, `scripts:check-syntax` all exit 0 (`startup:smoke` + `test:api` noted preexisting/environmental on this host)
- No duplicate JS+TS implementations; no unexplained suppressions (reconcile Phase 12/13)
- All spec §24 invariants verified (identity / risk / tenancy / audit / x402 no-payment / Agent-LLM excludes x402_purchase / Fleet = LLM + x402 / Claude-code advisory / stored cost canonical / pricing fallbacks preserved)
- `FINAL-MIGRATION-REPORT.md` exists and lists every intentional JS/MJS exception

## Mandatory commands (run each, surface last ~10 lines + exit code)
- npm run typecheck
- npm run lint
- npx vitest run
- npx next build
- npm run docs:check
- npm run contracts:check
- npm run openapi:check
- npm run api:inventory:check
- npm run route-sql:check
- npm run version:sync:check
- npm run sdk:integration
- npm run sdk:integration:python
- npm run scripts:check-syntax

## Evidence required in transcript
- every gate command exit code + last lines; FINAL-MIGRATION-REPORT.md; /spend/code screenshot; intentional-exceptions list; repo-state added-lines cleanliness counts

## Notes
PARENT-OWNED final integration + verification + completion judgment. Do NOT commit/push/deploy/publish/release without explicit operator approval (spec §22). This phase finishes the run; the final audit (PROTOCOL.md) then re-verifies against ROADMAP.md before SUPERGOAL_RUN_COMPLETE.
