SUPERGOAL_PHASE_START
Phase: 1 of 14 — TS Foundation + tooling
Task: Establish strict TS with JS coexistence; make doc/contract generators TS-aware BEFORE any code converts.
Type: brownfield, refactor
Mandatory commands: npm run typecheck, npm run lint, npx next build, npm run openapi:check, npm run api:inventory:check, npm run route-sql:check, npm run version:sync:check
Acceptance criteria: 6
Evidence required: tsconfig contents, typecheck exit 0, build summary, each check exit code, current branch
Depends on phases: none (Phase 0 baseline captured in STATE.md)

## Why
Strict TS must coexist with JS (allowJs) and the route-discovery generators must accept .ts/.tsx BEFORE any route converts — else openapi/api-inventory/route-sql silently skip TS routes. PARENT-OWNED (config only).

## Work
- See ROADMAP.md "Phase 1" for full deliverables. Authoritative: spec `docs/plans/typescript-migration.md` §8 (+ the route-generator gap fix recommended in plan review).
- Create `refactor/typescript-migration` branch (safe local op; NO commit).
- Add strict `tsconfig.json` (spec §8.1: allowJs:true, checkJs:false, noEmit, strict, noUncheckedIndexedAccess, forceConsistentCasingInFileNames, Next plugin). Add `typecheck` script + typescript/@types/{react@18,react-dom@18,node} devDeps. Wire eslint TS parser (@typescript-eslint) compatibly with eslint 8 + eslint-config-next.
- Update the shared route-inventory discovery used by `scripts/generate-api-inventory.mjs`, `scripts/generate-openapi.mjs`, `scripts/check-route-sql-guard.mjs` to match `route.{js,ts,tsx}`; re-generate baselines; confirm green.
- Confirm `next.config.js` version injection (`NEXT_PUBLIC_DASHCLAW_VERSION`) survives.
- Prove toolchain with a throwaway `app/lib/__ts_probe__.ts`, then delete it.

## Acceptance criteria (all must pass — verify each in transcript)
- `npm run typecheck` exists and exits 0 on the all-JS baseline (allowJs coexistence)
- `npm run lint` exits 0
- `npx next build` exits 0
- `npm run openapi:check`, `npm run api:inventory:check`, `npm run route-sql:check`, `npm run version:check`, `npm run version:sync:check` all exit 0 after the generator update
- Throwaway `.ts` probe typechecks then removed (no stray `.ts`)
- `git branch --show-current` == `refactor/typescript-migration`

## Mandatory commands (run each, surface last ~10 lines + exit code)
- npm run typecheck
- npm run lint
- npx next build
- npm run openapi:check
- npm run api:inventory:check
- npm run route-sql:check
- npm run version:sync:check

## Evidence required in transcript
- tsconfig.json contents; typecheck exit 0; build summary; each check exit code; current branch

## Notes
Parent-owned. Do NOT convert any app code this phase. If the generator update is non-trivial, keep it minimal (extension glob only) — do not refactor the generators.
