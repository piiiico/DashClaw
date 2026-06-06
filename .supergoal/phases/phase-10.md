SUPERGOAL_PHASE_START
Phase: 10 of 14 — Integrations, SDK, scripts
Task: Convert actively-maintained integrations to TS; keep Node + Python SDK public contracts stable; leave stable ops .mjs as documented exceptions.
Type: brownfield, refactor
Mandatory commands: npm run typecheck, npm run lint, npm run sdk:integration, npm run sdk:integration:python, npm run version:sync:check, npm run contracts:check
Acceptance criteria: 6
Evidence required: sdk:integration output, version:sync:check exit 0, SDK-bridge decision + evidence
Depends on phases: 2, 3, 5
Cleanliness override: converting integration modules that retain existing `console.error`/`console.warn`; NO net-new debug prints.

## Why
Integrations + SDK touch external contracts. Preserve the Node SDK public API (the `index.cjs` instanceof/nested-proxy bridge is load-bearing) and the unified platform+node+python version. Python SDK + ~60 stable ops `.mjs` are NOT converted.

## Work
- See ROADMAP.md "Phase 10". Authoritative: spec §17 (§17.1 integrations, §17.2 SDKs, §17.3 scripts).
- Convert discord/telegram/webhooks/stripe/email/mcp/openclaw/hermes/notification adapters preserving: webhook DNS-rebinding + HMAC + Undici dispatch; adapters fire-and-forget-never-throw; MCP `tools.js` JSON schemas + handler signatures.
- Node SDK: convert internals ONLY behind a passing `instanceof` + nested-namespace (`client.execution.capabilities.list()`) contract test; otherwise keep `sdk/dashclaw.js` + `index.cjs` as a DOCUMENTED JS exception. Preserve method counts + response compat. Python SDK untouched.
- Selectively convert check-scripts that parse structured data; keep the ~60 isolated ops `.mjs` as listed exceptions.

## Acceptance criteria (all must pass — verify each in transcript)
- `npm run typecheck` + `npm run lint` clean
- `npm run sdk:integration` exit 0 (Node SDK harness, 5 cases)
- `npm run sdk:integration:python` exit 0 (93 tests)
- `npm run version:sync:check` exit 0 (platform+node+python aligned)
- `npm run contracts:check` exit 0
- Node SDK `instanceof`/nested-namespace bridge proven intact OR SDK internals left as a documented JS exception

## Mandatory commands (run each, surface last ~10 lines + exit code)
- npm run typecheck
- npm run lint
- npm run sdk:integration
- npm run sdk:integration:python
- npm run version:sync:check
- npm run contracts:check

## Evidence required in transcript
- sdk:integration output; sdk:integration:python summary; version:sync:check exit 0; SDK-bridge decision + evidence

## Notes
Parent owns the Node-SDK public-contract decision. Do NOT make incompatible public API changes or desync versions (spec §22 approval gates).
