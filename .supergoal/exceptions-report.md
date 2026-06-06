# Intentional JavaScript / MJS Exceptions (running list → Phase 14 final report §25)

Per spec §24.1 ("production application code is TypeScript or TSX **except explicitly documented exceptions**") and §24.32 / §25 ("the final report documents every intentional JavaScript exception"), this file tracks every file/area deliberately retained as JavaScript, with rationale. Compiled into `FINAL-MIGRATION-REPORT.md` at Phase 14.

## A. SDKs (spec §17.2)

- **`sdk/dashclaw.js` + `sdk/index.cjs` (Node SDK)** — **documented JS exception.** The `index.cjs` lazy `Symbol.hasInstance` error-class bridge + deferred nested-namespace proxy (`client.execution.capabilities.list()`) is load-bearing; TS conversion of internals risks breaking `instanceof` checks and nested access for marginal internal-typing gain. Public method counts + response shapes are approval-gated. Verified stable WITHOUT conversion: `sdk:integration` (5/5 cases) + `version:sync:check` (4.2.0) green. Decision is parent-owned (spec §17.2 migration-team note); keeping it unchanged is the no-incompatible-change/safe option.
- **`sdk-python/` (Python SDK)** — explicitly NOT converted ("Do not convert Python to TypeScript", §17.2). Verified via `sdk:integration:python` (93 tests OK).

## B. Separate publishable packages / excluded from main tsconfig

- **`mcp-server/lib/*.js` (5 files) + `bin/dashclaw-mcp.js`** — standalone publishable MCP server package with its own `node_modules` + runtime; the 26-tool JSON schemas + handler signatures are contract-critical and it is not in the main tsc gate. Convert as a dedicated package effort. The **app-side** `/api/mcp/route.ts` IS converted (Phase 9/8).
- **`packages/openclaw-plugin/`** (OpenClaw integration) — excluded from main tsconfig (`packages`); separate package boundary. Documented exception.
- **`packages/dashclaw-demo/`** — excluded; demo package.
- **`plugins/dashclaw/` (+ Hermes/Codex plugin bundles)** — separate plugin bundles, own manifests/versioning. Documented exception.
- **`cli/`** — excluded from main tsconfig (`cli`); separate package with its own `node:test` suite. Documented exception.

## C. Non-TS-convertible

- **`.claude/hooks/*.py` (17 Python guard/hook files)** — "Claude Code hooks" in §17.1 are Python, not TS-convertible. Documented exception.

## D. Ops scripts (spec §17.3, exceptions criteria 1–4)

- **`scripts/*.mjs` (112 files)** — isolated, already-tested operational/CI tooling (version sync, openapi/inventory/contract/route-sql generators+checkers, release, livingcode, pricing refresh, etc.). Conversion adds little type-safety, they are not covered by a verifying typecheck gate, and they are well-exercised by CI. Retained as JS/MJS per §17.3(1–4). (`scripts/check-api-surface.mjs` was edited in Phase 10 — extension-agnostic route discovery — but stays `.mjs`.)

## E. Authoritative-by-design JS

- **`app/lib/validate.js`** — the authoritative runtime validator, deliberately kept `.js` (Phase 3/8 decision); JSDoc `@returns` types its callers without converting the file. Do not replace runtime validation with TS types (spec hard rule).

## F. Archived / dead code (never convert)

- **`app/api/_archive/**/*.js` (48 files)** — archived legacy platform features; CLAUDE.md "do not extend." Out of the governance runtime. Never convert.

## G. Remaining internal `app/lib/*.js` business-logic modules — SCOPE FLAG for operator (Phase 14 decision)

The operator-approved 14-phase ROADMAP (and spec §6–§18 phases) deliberately TARGET specific high-value / governance-critical surfaces for conversion: domain types, runtime validation, pricing/FinOps, security-critical identity/guard, x402, DB repositories, API routes, UI, and the §17.1 integrations. **No phase targets the remaining internal `app/lib` business-logic modules.** As of Phase 10 these remain `.js` (~150 files, excluding demo/data):

- `app/lib/claude-code/**` (~31) — Code Sessions analytics/optimal-files/ingest
- `app/lib/behavior/**` (~8) — Policy Coach behavior learning
- `app/lib/integrity/**` (~8) — signing/JWKS helpers (jwks-verifier was converted in Phase 5; remainder here)
- `app/lib/compliance/**` (~5), `app/lib/hosted/**` (~4), `app/lib/routing/**` (~3), `app/lib/guardrails/**` (~2)
- singletons: `workflow-executor.js`, `workflow-condition.js`, `step-handlers.js`, `usage.js`, `org.js`, `template-vars.js`, `starterSnippet.js`, `skill-scanner.js`, `integration-health.js`, `integrationConfigs.js`, `health-change-alerts.js`, `drift.js`, `signals.js`, `compliance/exporter.js`, etc.
- demo/data: `app/lib/demo/**` (~14), `landingData.js`, `demo*Data.js` — static fixtures/data, lowest TS value.

**Per §24.1 these are permissible as "explicitly documented exceptions," and this is faithful to the approved targeted plan.** They are governed at the type boundary already (their `.ts` callers infer types via `allowJs`). **Recommendation (Phase 14 §25 "Recommended follow-up milestones"):** a dedicated follow-up milestone to convert these internal modules to TS, OR an explicit operator decision to retain them as documented exceptions. This is surfaced (not silently dropped) so the operator can elect scope at completion.
