SUPERGOAL_PHASE_START
Phase: 3 of 14 — Runtime validation alignment
Task: Align Zod schemas at every external boundary; infer TS from schemas; do NOT replace runtime validation with types.
Type: brownfield, refactor
Mandatory commands: npm run typecheck, npm run lint, npx vitest run
Acceptance criteria: 4
Evidence required: schema file list, x402 reject-amount test output, env-schema behavior, typecheck exit 0
Depends on phases: 2

## Why
TS types do not validate runtime input. Every external boundary keeps a runtime schema; types are INFERRED from schemas, never substituted for them (spec §5.9, §10).

## Work
- See ROADMAP.md "Phase 3". Authoritative: spec §10 (boundary list), §10.1 (x402 reject-list), §10.2 (FinOps period+lens).
- Define/align Zod schemas (zod@4 present): HTTP bodies/query/headers, API keys, JWT claims, webhook/Discord/Telegram/Stripe payloads, x402 provider+purchase, DB JSON columns, SDK/MCP/Code-Session ingest, workflow inputs.
- Centralized `process.env` schema (tooling finding: 212 reads / 84 files; drizzle.config.js reads DATABASE_URL at import). Validate required vars at startup WITHOUT removing existing fallbacks/defaults.
- x402 §10.1: reject negative / NaN / Infinity amounts, unsupported currencies (where allow-list exists), invalid provider+endpoint combos, untrusted client verification state, client attempts to lower server risk.
- Infer TS types from schemas; remove duplicate hand-written interfaces that can drift.

## Acceptance criteria (all must pass — verify each in transcript)
- New/updated schemas typecheck + lint clean
- A unit test proves the x402 purchase schema rejects negative, NaN, and Infinity amounts
- The env schema validates required vars at startup without weakening existing fallbacks
- No boundary that previously validated now skips validation (types did not replace runtime checks)

## Mandatory commands (run each, surface last ~10 lines + exit code)
- npm run typecheck
- npm run lint
- npx vitest run (schema-scoped files only this phase)

## Evidence required in transcript
- Schema file list; x402 reject-amount test output; env-schema startup behavior; typecheck exit 0

## Notes
Parent owns the shared schema modules; workers import them in later phases. Preserve the intentional `claude-code`→`claude_code` compat (do not "fix" it).
