# Repo map

_Generated 2026-06-05 16:00:52_

## Top-level layout
- AGENTLENS_INTEGRATION_GOAL.md
- AGENTS.md
- AUDIT_FINDINGS.md
- CHANGELOG.md
- CLAUDE.md
- CONTRIBUTING.md
- DASHCLAW_DURABLE_FINALITY_RELEASE_READINESS_GOAL.md
- DEMO.md
- DESIGN.md
- DURABLE_FINALITY_RELEASE_READINESS_REPORT.md
- Dockerfile
- GEMINI.md
- LICENSE
- OVERNIGHT-CLEANUP-REPORT.md
- PRODUCT.md
- PROJECT_DETAILS.md
- QUICK-START.md
- README.md
- SPEC-mega.md
- SYNC_AUDIT.md
- SYNC_AUDIT_IMPLEMENTATION.md
- __tests__
- agents
- app
- bar-mega.json
- brand
- cli
- conductor
- contracts
- dist
- docker-compose.yml
- docs
- drizzle
- drizzle.config.js
- examples
- hooks
- install-mac.sh
- install-windows.bat
- livingcode
- mcp-server

## Source directories (depth 2)
### `app/`
- app/actions
- app/actions/[actionId]
- app/activity
- app/agents
- app/agents/registry
- app/agents/[agentId]
- app/analytics
- app/analytics/components
- app/api
- app/api/actions
- app/api/activity
- app/api/admin
- app/api/agents
- app/api/analytics
- app/api/approvals
- app/api/artifacts
- app/api/assumptions
- app/api/auth
- app/api/behavior
- app/api/billing
- app/api/capabilities
- app/api/code-sessions
- app/api/compliance
- app/api/cron
- app/api/discord
- app/api/docs
- app/api/doctor
- app/api/drift
- app/api/evaluations
- app/api/finops

### `packages/`
- packages/dashclaw-demo
- packages/dashclaw-demo/bin
- packages/openclaw-plugin
- packages/openclaw-plugin/dist
- packages/openclaw-plugin/node_modules
- packages/openclaw-plugin/src

## File counts (top extensions)
- `.js`: 1076 files
- `.md`: 281 files
- `.mjs`: 174 files
- `.jsx`: 169 files
- `.py`: 156 files
- `.json`: 91 files
- `.png`: 55 files
- `.yml`: 25 files
- `.sql`: 23 files
- `.txt`: 10 files

## Largest source files (top 15 by line count)
- `app/docs/page.js` (2951 lines)
- `sdk/legacy/dashclaw-v1.js` (2945 lines)
- `sdk-python/dashclaw/client.py` (2206 lines)
- `scripts/migrate-multi-tenant.mjs` (1840 lines)
- `middleware.js` (1545 lines)
- `sdk/dashclaw.js` (1539 lines)
- `scripts/bootstrap-agent.mjs` (1493 lines)
- `scripts/test-full-api.mjs` (1409 lines)
- `schema/schema.js` (1371 lines)
- `app/decisions/[actionId]/page.js` (1266 lines)
- `drizzle/0000_clammy_falcon.sql` (1242 lines)
- `scripts/test-actions.mjs` (1124 lines)
- `packages/openclaw-plugin/src/index.ts` (1115 lines)
- `app/lib/repositories/actions.repository.js` (1092 lines)
- `cli/bin/dashclaw.js` (1044 lines)

## Test surface
- Directories named `test`: 102
- Directories named `tests`: 29
- Directories named `__tests__`: 1
- Directories named `spec`: 1
- Directories named `specs`: 2
- Test files (by name pattern): 991

## Notable config / infra
- `.eslintrc.json`
- `.github/workflows`
- `Dockerfile`
- `docker-compose.yml`
- `drizzle.config.js`
- `next.config.js`
- `playwright.config.js`
- `postcss.config.js`
- `tailwind.config.js`
- `vercel.json`
- `vitest.config.js`

## Recent activity (last 10 commits)
- `e8709bbc` 2026-06-05 clean up
- `36c7da12` 2026-06-05 feat(x402): one-call recordX402Purchase self-report in both SDKs (v4.2.0)
- `0379b8c0` 2026-06-05 fix(x402): resolve provider_id from provider name server-side so name-only purchases aren't blank
- `c55c2499` 2026-06-05 chore(release): bump SDK release plan to 4.1.2 to match manifests
- `24c5cad0` 2026-06-05 release 4.1.2: agent governance, identity, risk, and x402 hardening
- `6c79a05f` 2026-06-05 harden agent governance, identity, risk, and x402 integrity
- `e814ab21` 2026-06-05 fix(openclaw-plugin): detect x402 from Codex shell_command + wrappers; add debug logging
- `1db0c502` 2026-06-05 feat(openclaw-plugin): govern + record x402 capability payments
- `28c58a85` 2026-06-05 docs: surface FinOps Spend subsystem + x402 across docs, marketing, SDK refs; fix stale counts
- `8f33de91` 2026-06-05 chore(scripts): add seed-x402-sample for testing the Spend x402 surfaces

## Files churned in last 20 commits (top 10)
- `public/downloads/dashclaw-platform-intelligence.zip.manifest` (3×)
- `public/downloads/dashclaw-platform-intelligence.zip` (3×)
- `public/downloads/dashclaw-governance-plugin.zip.manifest` (3×)
- `public/downloads/dashclaw-governance-plugin.zip` (3×)
- `packages/openclaw-plugin/src/HOOK.md` (3×)
- `packages/openclaw-plugin/package.json` (3×)
- `packages/openclaw-plugin/openclaw.plugin.json` (3×)
- `packages/openclaw-plugin/README.md` (3×)
- `README.md` (3×)
- `CHANGELOG.md` (3×)

_End repo map._
