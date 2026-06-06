# Stack context

_Generated 2026-06-05 16:00:47_

## Language signals
- **Node/JS/TS** — package.json present
  - Name: `dashclaw-platform`, version: `4.2.0`
  - Top dependencies: @cfworker/json-schema, @e965/xlsx, @modelcontextprotocol/server, @neondatabase/serverless, @playwright/test, @testing-library/react, @vercel/analytics, @vitejs/plugin-react, @vitest/coverage-v8, @xyflow/react, acorn, autoprefixer, better-sqlite3, d3-drag, d3-force
  - Framework: **next**
  - Framework: **react**

## Package manager
- **npm** (package-lock.json)

## Likely commands
From package.json scripts:
- `dev` → `next dev -p 3000 --turbopack`
- `demo` → `node scripts/run-demo.mjs`
- `build` → `next build`
- `start` → `next start -p 3000`
- `lint` → `eslint .`
- `docs:check` → `node scripts/validate-docs.mjs`
- `doctor` → `node scripts/doctor.mjs`
- `db:migrate` → `node scripts/auto-migrate.mjs`
- `hosted:check-ready` → `node scripts/check-hosted-ready.mjs`
- `hosted:smoke` → `node scripts/smoke-hosted.mjs`
- `livingcode:refresh` → `node scripts/livingcode-refresh.mjs`
- `openapi:generate` → `node scripts/generate-openapi.mjs`
- `openapi:check` → `node scripts/check-openapi-diff.mjs`
- `api:inventory:generate` → `node scripts/generate-api-inventory.mjs`
- `api:inventory:check` → `node scripts/check-api-inventory-diff.mjs`
- `route-sql:baseline:generate` → `node scripts/generate-route-sql-baseline.mjs`
- `route-sql:check` → `node scripts/check-route-sql-guard.mjs`
- `version:check` → `node scripts/check-version-hardcodes.mjs`
- `version:sync:check` → `node scripts/check-version-sync.mjs`
- `version:set` → `node scripts/set-version.mjs`
- `sdk:count` → `node scripts/count-sdk-methods.mjs`
- `pricing:refresh` → `node scripts/refresh-model-pricing.mjs`
- `pricing:refresh:apply` → `node scripts/refresh-model-pricing.mjs --apply`
- `hooks:install` → `node scripts/install-hooks.mjs`
- `hooks:diagnose` → `node scripts/diagnose-hooks.mjs`

## Git
- Branch: `main`
- Remote: https://github.com/ucsandman/DashClaw.git
- Working tree: 1 files changed

## Test / lint heuristics
- Has script: `build`
- Has script: `test`
- Has script: `lint`
- Has script: `dev`
- Has script: `start`

_End stack context._
