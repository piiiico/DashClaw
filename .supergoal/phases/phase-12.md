SUPERGOAL_PHASE_START
Phase: 12 of 14 — Unsafe-typing audit
Task: Review every unsafe-typing occurrence; justify, narrow, or remove; zero unexplained suppressions; no `any` on security/tenancy/pricing/payment boundaries.
Type: brownfield, refactor
Mandatory commands: npm run typecheck, npm run lint
Acceptance criteria: 4
Evidence required: suppression census before/after, audit doc, boundary grep
Depends on phases: 4, 5, 6, 7, 8, 9, 10, 11

## Why
The dragnet (spec §19). Strict types are only as strong as their escape hatches; audit every one.

## Work
- See ROADMAP.md "Phase 12". Authoritative: spec §19.
- Search and review every: `any`, `unknown`, `as`, `!`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`, `JSON.parse`, `process.env`, `Record<string, unknown>`.
- `unknown` acceptable only when narrowed before use; `any` acceptable only at a proven external limitation with a nearby documented reason + removal note (spec §8.3). Extra scrutiny: identity, org context, guard inputs, policy rules, money, currency, pricing, x402 purchase, DB JSON, webhook responses, SDK payloads.
- Write `.supergoal/unsafe-typing-audit.md` enumerating each occurrence + verdict.

## Acceptance criteria (all must pass — verify each in transcript)
- `npm run typecheck` + `npm run lint` clean
- Zero unexplained suppressions remain (grep reconciled with audit doc)
- No `any` across identity / org / guard / money / currency / x402 boundaries (grep evidence)
- Each remaining `unknown` is narrowed before use (audit doc cites the narrowing)

## Mandatory commands (run each, surface last ~10 lines + exit code)
- npm run typecheck
- npm run lint

## Evidence required in transcript
- suppression census before/after counts; `.supergoal/unsafe-typing-audit.md`; boundary `any` grep

## Notes
Do not replace `any` with meaningless generic types that provide no real safety (spec §19).
