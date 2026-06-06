# UltraCode Dynamic Workflow + Goal Prompt: Governance Posture Score

Use this whole file as the Claude Code starting prompt for resuming the DashClaw governance posture-score feature. It combines the dynamic-workflow controller instructions with the final `/goal` execution anchor.

```text
You are Claude Code operating as the controller for a DashClaw feature branch. Use an UltraCode-style dynamic workflow: keep the main session as the accountable controller, spawn/fork focused implementers and reviewers for independent subtasks, and require evidence from the repo and test output before claiming completion.

Repository and branch:
- Repo: C:/Projects/DashClaw
- Worktree: C:/Projects/DashClaw/.claude/worktrees/feat+posture-score-engine
- Branch: worktree-feat+posture-score-engine
- Current HEAD: 40d35f7e
- Base migrated main: 2fe1268d
- Upstream: origin/worktree-feat+posture-score-engine
- Do not merge or push to main until the final finishing-development-branch step.

Read first, in this order:
1. C:/Projects/DashClaw/docs/superpowers/2026-06-06-posture-score-PROGRESS.md
2. C:/Projects/DashClaw/docs/superpowers/specs/2026-06-05-governance-posture-score-design.md
3. C:/Projects/DashClaw/docs/superpowers/plans/2026-06-05-governance-posture-score.md
4. C:/Projects/DashClaw/.impeccable.md before any UI work

Operating model:
- Use superpowers:subagent-driven-development as the execution method.
- For each remaining task, use a fresh implementer subagent or forked worker when the work is separable.
- After each implementation, run a spec-compliance review and a code-quality review before marking the task complete.
- The controller owns final judgment, fixes, commits, and progress tracking.
- Workers must return evidence: changed files, exact behavior implemented, tests added or updated, commands run, failures observed, and residual risk.
- Do not let workers mark their own work complete without controller verification.

Dynamic workflow shape:
1. Controller recon:
   - cd C:/Projects/DashClaw/.claude/worktrees/feat+posture-score-engine
   - Confirm branch and git status.
   - Run `npx vitest run` immediately and confirm only the 4 known worktree/environment failures appear.
   - If any new failure appears, stop feature work and triage it first.

2. Task execution loop for Tasks 8 through 20:
   - Before each task, re-read the relevant plan section and inspect current files.
   - Spawn one implementer for the task with a narrow file/surface scope.
   - Run targeted tests for that task.
   - Spawn or perform spec-compliance review against the design spec.
   - Spawn or perform code-quality review against local repo patterns and ZERO SLOP expectations.
   - Fix every material finding.
   - Run the task gate.
   - Commit the task with a focused message.
   - Update the plan checklist or progress doc only when evidence supports it.

3. Reviewer rubric:
   - No inline SQL in `app/api/**/route.ts`.
   - No behavior that lets drafting an inactive policy raise the posture score.
   - No call to `evaluateGuard` for per-unit replay, because that persists audit rows.
   - Reuse `evaluatePolicy` or the existing simulator path for replay and policy preview.
   - Route handlers follow existing `getSql()`, `getOrgId(request)`, repository, and `apiErrorResponse` patterns.
   - Repositories take `SqlTag` first, then `orgId`, then filters or inputs.
   - Numeric `posture_snapshots.score` is coerced with `Number(score)` on read.
   - MCP and CLI resolve flows are draft-only. Agents must never self-activate enforcement.
   - UI must honor `.impeccable.md`: dark-only, token-first, orange as signal only, lucide icons, tabular numbers, calm operational surface, no generic SaaS drift.

Known worktree gate caveats:
- Use `npm run build`, not `npx next build`. Plain `npx next build` uses Turbopack and produces bogus module errors in this worktree.
- `npm run lint` cannot resolve `next/core-web-vitals` in this nested worktree. Defer lint to canonical-repo integration.
- Full `npx vitest run` should have only these known environment failures:
  - `__tests__/unit/install-hooks.test.js`
  - `refresh-model-pricing.test.js`
  - `hosted/check-hosted-ready.test.mjs`
  - 1 CRLF assertion in `onboarding-snippets.test.js`
- If full Vitest shows anything beyond those known failures, treat it as a blocker.

Authoritative in-worktree gate after each task:
- `npx tsc --noEmit`
- Targeted Vitest for changed surfaces
- `npx vitest run` differential, allowing only the 4 known environment failures
- `npm run build`
- `npm run route-sql:check`

Phase 2, Tasks 8 through 12:
- Task 8: Add `posture_findings_state` and `posture_snapshots` to `schema/schema.js` and `drizzle/0022_posture.sql`; run `npm run db:migrate` at execution time; ensure snapshot score reads coerce `Number(score)`.
- Task 9: Add finding-state repository reads/writes and merge finding state into `signals.ts` so resolved, snoozed, and accepted findings drop from the open queue.
- Task 10: Add `GET /api/posture/findings` with `status` and `dimension` filters.
- Task 11: Add `POST /api/posture/findings/[key]/resolve` for `create_draft`, `snooze`, and `accept_risk`.
  - Before implementing Task 11, confirm the exact Policy-Coach inactive-draft insert path.
  - `create_draft` inserts an inactive guard policy and marks the finding `drafted`, not `resolved`.
  - Add the honesty property test: after `create_draft`, `GET /api/posture` score is unchanged.
- Task 12: Add `POST /api/posture/scan` to recompute posture and persist a snapshot.

Phase 3, Tasks 13 through 15:
- Read `.impeccable.md` before starting.
- Build `/posture` as a real operator surface: score hero, trend sparkline, six dimension cards, prioritized next queue, risk-accepted ledger, resolve preview flow.
- Reuse the Policy-Coach simulator or existing simulate summary for draft previews.
- Make the UI honest: creating a draft does not move the score until a human activates the policy and a later scan proves it fires.
- Verify responsive layout, text fit, keyboard accessibility, and token usage. Do not hardcode colors in JSX unless the existing codebase already requires it for that exact pattern.

Phase 4, Tasks 16 through 17:
- CLI:
  - Add `dashclaw posture`
  - Add `dashclaw next`
  - Add `dashclaw posture resolve <key>`
  - Resolve is draft-only.
  - Tests belong near `cli/test/api.test.js` and should stub `global.fetch`.
- MCP:
  - Add `dashclaw_posture`
  - Add `dashclaw_posture_next`
  - Update `mcp-server/lib/tools.js` definitions and handlers.
  - Resolve behavior, if exposed, is draft-only.

Phase 5, Tasks 18 through 20:
- Use the dashclaw-ship skill or equivalent local ship pass.
- Regenerate derived artifacts as required: OpenAPI, API inventory, LivingCode, SDK parity docs, app docs, SDK READMEs, PROJECT_DETAILS.
- Run version bump lockstep with `npm run version:set <x.y.z>`, then `npm install`.
- Do not run owner-only publishing unless explicitly authorized.

Final integration:
- Use superpowers:finishing-a-development-branch in the canonical repo, not the nested worktree.
- Run the full clean gate in canonical repo where lint and the known worktree environment failures should not apply.
- Commit to `main` only at the final step. No PR.
- Push main only when final gate evidence is clean.

Out-of-scope but note for later:
- The migrated lockfile pins `rolldown 1.0.0-rc.13`, whose shebang parse bug breaks three script-import tests on Windows. Do not fix as part of posture unless it blocks canonical integration.

Stop conditions:
- Stop and report if a new full-suite failure appears outside the 4 known environment failures.
- Stop and report if the inactive-draft path cannot be verified before Task 11.
- Stop and report if schema migration application fails in a way that may affect shared data.
- Stop and report before any push to main.

Final answer format:
- Current branch and final commit SHA.
- Tasks completed.
- Files changed by area.
- Verification commands and exact outcome.
- Known residual risks.
- Whether main was touched or not.

/goal
Ship the remaining governance posture-score feature on `worktree-feat+posture-score-engine` from Task 8 through final integration: add storage and finding state, implement the findings and scan APIs, build the `/posture` operator page, add CLI and MCP surfaces, complete the ship/version/docs pass, and integrate to main only after the clean final gate. Preserve the core trust property throughout: the score only rises from active, proven-to-fire governance, never from inactive drafts or toothless policies.
```
