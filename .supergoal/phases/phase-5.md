SUPERGOAL_PHASE_START
Phase: 5 of 14 — Security-critical conversion (PARENT identity + risk)
Task: Convert + strengthen identity, JWT/JWKS, replay, action-binding, guard, risk, audit persistence, scanners.
Type: brownfield, refactor
Mandatory commands: npm run typecheck, npm run lint, npx vitest run
Acceptance criteria: 6
Evidence required: identity-override test, risk-max test, audit-persist-fail test, typecheck exit 0
Depends on phases: 2, 3
Cleanliness override: converting modules that legitimately retain operator-signal `console.error`/`console.warn` (guard replay/act-binding/audit-fail logs); NO net-new debug prints — reviewer confirms preserved-vs-new.

## Why
Identity, risk, and audit are the governance core. PARENT-OWNED identity + risk contracts; workers may convert leaf scanners under direction.

## Work
- See ROADMAP.md "Phase 5". Authoritative: spec §12 (§12.1 identity outcome, §12.2 risk outcome, §12.3 audit outcome).
- Convert `identity-resolution.ts`, `identity.ts`, `agent-identity-resolve.ts`, `jwks-verifier.ts`, `act-binding.ts`, `guard.ts`, `guardrails/evaluator.ts`, `repositories/jti-replay.repository.ts`, `repositories/guard.repository.ts`, `promptInjection.ts`, `security.ts`.
- ONE typed `resolveAgentIdentity` used by all action-creating routes. ONE typed risk result flowing to guard_decisions/action_records/x402/alerts/analytics/responses/UI. Preserve: verified-JWT-overrides-body; client risk can only RAISE (`max(server, agentReported)`); integer 0–100; awaited fail-loud `guard_decisions` INSERT (`GUARD_AUDIT_PERSIST_FAILED`); `evaluateGuard` throws on missing orgId; redaction of sensitive context before persist.

## Acceptance criteria (all must pass — verify each in transcript)
- `npm run typecheck` + `npm run lint` clean
- Test: verified JWT `sub` overrides body agent_id; untrusted token never applies claims
- Test: `computeRiskScore` integer 0–100 AND `effectiveRiskScore = max(server, agentReported)` — client cannot lower
- Test: `guard_decisions` INSERT awaited; failure throws `GUARD_AUDIT_PERSIST_FAILED` (no unaudited success)
- Test: `evaluateGuard` throws on missing/empty orgId (tenant boundary)
- Guard/identity/replay-scoped `npx vitest run` passes

## Mandatory commands (run each, surface last ~10 lines + exit code)
- npm run typecheck
- npm run lint
- npx vitest run (guard + identity + security scoped this phase)

## Evidence required in transcript
- identity-override test; risk-max test; audit-persist-fail test; orgId-required test; typecheck exit 0

## Notes
PARENT-OWNED identity+risk. Preserve current behavior exactly — do NOT "fix" the preexisting architectural observations (JWKS per-process cache, process-wide replay env, guard→action race) without explicit approval; the migration preserves, it does not redesign.
