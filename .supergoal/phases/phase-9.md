SUPERGOAL_PHASE_START
Phase: 9 of 14 — UI / TSX conversion [INTEGRATION GATE]
Task: Convert ~128 React pages/components to TSX, preserving design, CSS tokens, the /spend active-state, and /spend/code token-resolved brand-orange.
Type: brownfield, refactor, ui
Mandatory commands: npm run typecheck, npm run lint, npx next build, npx vitest run
Acceptance criteria: 5
Evidence required: build summary, /spend/code screenshot path, active-state confirmation, typecheck exit 0
Depends on phases: 2, 3

## Why
The dashboard is the operator surface. Convert to TSX without altering the design; preserve token-first rendering. 10 NON-OVERLAPPING worker groups.

## Work
- See ROADMAP.md "Phase 9" for the 10 UI groups. Authoritative: spec §16. READ `.impeccable.md` before any visual change (canonical design context).
- Convert `.jsx`→`.tsx`: type props, API responses, loading/error states, event handlers, chart data, nullable/partial records; render decision/status unions exhaustively.
- Preserve current design; preserve `/spend` nav active-state; preserve `/spend/code` Recharts brand-orange via the existing `getComputedStyle` token-resolution pattern. Add a focused browser/visual check that the brand-orange chart paints.
- Testable pages must remain `.tsx` (Vitest react loader). Avoid unnecessary component abstractions.

## Acceptance criteria (all must pass — verify each in transcript)
- `npm run typecheck` + `npm run lint` clean
- `npx next build` exit 0
- Current design preserved; NO new hardcoded hex (token-first); `/spend` active-state preserved; `/spend/code` brand-orange still token-resolved — visual/browser check + screenshot
- Full gate: `npx vitest run` green
- No `any` on API-response props in converted pages (spot-grep)

## Mandatory commands (run each, surface last ~10 lines + exit code)
- npm run typecheck
- npm run lint
- npx next build
- npx vitest run

## Evidence required in transcript
- build summary; `/spend/code` screenshot path; `/spend` active-state confirmation; typecheck exit 0

## Notes
Dispatch via Ultracode workflow: one agent per isolated page/component cluster. The 5+ preexisting hardcoded `#f97316` chart files are PREEXISTING design debt — note in the final report but do NOT fix without approval (surgical scope). Use `frontend-verify` / browser for the visual check.
