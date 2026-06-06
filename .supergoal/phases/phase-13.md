SUPERGOAL_PHASE_START
Phase: 13 of 14 — Parallel adversarial review
Task: Run 15 independent reviewers that try to DISPROVE migration completeness; fix every confirmed critical/high.
Type: brownfield, refactor
Mandatory commands: npm run typecheck, npm run lint, npx vitest run
Acceptance criteria: 4
Evidence required: review doc with per-dimension verdicts, duplicate-impl grep, fixes + re-verify
Depends on phases: 1-12

## Why
Self-reports are not proof. Independent adversarial review across 15 dimensions is the completeness gate (spec §20).

## Work
- See ROADMAP.md "Phase 13". Authoritative: spec §20. Dispatch via an Ultracode workflow: read-only reviewers, one per dimension — type correctness, runtime validation, identity/authz, tenant isolation, guard/risk, audit durability, DB consistency, pricing, FinOps accounting, x402 governance + payment boundary, API compat, React correctness, test quality, build/deploy compat, dead-code/duplicate-impl.
- Each finding MUST cite severity + real file paths + direct evidence + failure/exploit scenario + recommended fix + verification method. Reject evidence-free claims. Recheck reviewer findings against actual repo conventions (some "issues" are settled CodeQL false-positives — see applied-memories).
- Fix every confirmed CRITICAL/HIGH (parent assigns + integrates). Re-verify.
- DB-semantics findings need real-Postgres reasoning (the mocked suite cannot catch ON-CONFLICT/numeric/null regressions).

## Acceptance criteria (all must pass — verify each in transcript)
- All 15 dimensions reviewed; `.supergoal/adversarial-review.md` written with per-dimension verdict + evidence
- Every confirmed critical/high fixed and re-verified
- No duplicate JS+TS implementation of the same module remains (grep both extensions across converted areas)
- `npm run typecheck` + `npm run lint` clean AND `npx vitest run` green after fixes

## Mandatory commands (run each, surface last ~10 lines + exit code)
- npm run typecheck
- npm run lint
- npx vitest run

## Evidence required in transcript
- review doc per-dimension verdicts; duplicate-impl grep; list of fixes + re-verification

## Notes
Reviewers read-only until findings accepted by the parent. Do not weaken tests/checks to clear a finding — fix the cause.
