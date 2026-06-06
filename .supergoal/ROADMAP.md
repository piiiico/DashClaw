# Roadmap: DashClaw JS → strict-TypeScript migration

**Task:** Convert the DashClaw Next.js app from JS/JSX to strict TS/TSX incrementally, behavior-preserving, test-gated, per `docs/plans/typescript-migration.md` (authoritative).
**Type:** brownfield, refactor
**Created:** 2026-06-05
**Total phases:** 14 (Phase 0 baseline/inventory already done during planning — see STATE.md)

> **Authoritative spec:** `docs/plans/typescript-migration.md`. This roadmap REFERENCES its sections (e.g. "spec §11") and does NOT replace or weaken it. Every invariant in spec §4 + §24 holds. Phase specs live in `.supergoal/phases/phase-N.md`.

## Context summary

- **Stack:** Next.js 16 (App Router) + React 18, Node 24, Postgres (Neon HTTP + postgres driver), Zod 4, Drizzle, Vitest 4, Playwright, ESLint 8. ~1076 `.js` + 169 `.jsx`, ~0 existing TS in the app.
- **Package manager:** npm. **Build/test/lint:** `npm run build` / `npx vitest run` / `npm run lint`. **Typecheck:** `npm run typecheck` (created in Phase 1).
- **Risky areas:** pricing refresh script + parity test (marker/path coupling); route-discovery generators key off `route.js`; Node SDK `index.cjs` instanceof/proxy bridge; Neon numeric-as-string; money columns mixed `real` vs `numeric`; 88 unchecked `JSON.parse`, 212 `process.env` reads, 150 money sites; org_id-only tenant isolation (no RLS).

## Assumptions (correct any that are wrong at plan review)

1. **Branch:** create isolated `refactor/typescript-migration` in Phase 1 (safe local op, no commit). Run is otherwise NO-COMMIT until you approve.
2. **Scope realism:** "done" = every converted packet verified + repo stays green + invariants intact + remaining JS documented as exceptions. A 1200-file strict conversion may need multiple incremental passes; the run does not fake 100% by mass-rename (spec §26).
3. **Archived routes excluded:** `app/api/_archive/**` (48 files) is NOT converted (documented exception; CLAUDE.md says don't extend `_archive`).
4. **Python SDK + shell scripts + stable ops `.mjs` (~60)** stay as-is (spec §3, §17.3).
5. **Preexisting-failing gate cmds** (`startup:smoke`, `test:api`) are environmental on this host — treated as preexisting, not migration gates (see STATE.md).
6. **No money/DB-semantics/currency/public-API change** without your approval (spec §22). Money columns stay `real`/`numeric` as-is.
7. **Per-packet checks are narrow** (typecheck + lint + domain tests/checks); the **full gate** runs at major integration boundaries (end of P4, P7, P8, P9) and the final audit (per your "avoid repeatedly running the entire suite").

## Risk top 3 (full list in THINKING.md §Risks)

1. **Scale / strict-error avalanche** — likelihood high → `allowJs:true` coexistence keeps repo green; convert by dependency-ordered packets; incremental, each independently verified.
2. **Pricing/route-generator tooling break** — likelihood high → Phase 1 updates route-discovery to `route.{js,ts,tsx}` BEFORE any route converts; Phase 4 updates `refresh-model-pricing.mjs` + parity test in lockstep with billing/pricing.
3. **Silent invariant erosion (pricing fallbacks / x402 exclusion / client-risk-lowering / DB null+numeric semantics)** — likelihood medium, impact critical → parent owns shared pricing/identity/money/risk contracts; per-difference tests; 15-dimension adversarial review (Phase 13); behavior-preservation over type-purity.

## Phase map

| # | Phase | Depends on | Deliverable | Spec |
|---|-------|------------|-------------|------|
| 1 | TS Foundation + tooling | 0 | `tsconfig.json`, `typecheck` script, eslint-TS, route-discovery + version-injection survive | §8 (+gap fix) |
| 2 | Domain type architecture (PARENT) | 1 | `app/lib/types/*` domain contracts | §9 |
| 3 | Runtime validation alignment | 2 | Zod schemas at every boundary + env schema | §10 |
| 4 | Pricing & FinOps foundation (PARENT money) | 2,3 | `billing.ts`, `pricing.ts`, shared rate-card, refresh script + parity preserved | §11 |
| 5 | Security-critical conversion (PARENT identity/risk) | 2,3 | identity/JWT/replay/act-binding/guard/risk/audit/scanners in TS | §12 |
| 6 | x402 repo + API conversion | 2,3,4,5 | `x402.repository.ts`, x402 routes, SDK x402 methods | §13 |
| 7 | Database repository conversion | 2,3,5 | 49 repos → TS in 7 ownership groups | §14 |
| 8 | API route conversion | 2,3,5,7 | 242 active routes → TS in 12 groups | §15 |
| 9 | UI / TSX conversion | 2,3 | ~128 jsx → tsx in 10 groups; tokens + spend states preserved | §16 |
| 10 | Integrations, SDK, scripts | 2,3,5 | integrations TS; Node SDK public surface stable; ops `.mjs` exceptions | §17 |
| 11 | Test migration + regression coverage | 4–10 | tests → TS + spec §18 regression matrix | §18 |
| 12 | Unsafe-typing audit | 4–11 | reviewed/justified `any`/`as`/`!`/`JSON.parse`/`process.env` | §19 |
| 13 | Parallel adversarial review | 1–12 | 15-dimension review; confirmed crit/high fixed | §20 |
| 14 | Polish, Harden, Docs & Final report | 1–13 | full gate green, docs accurate, `FINAL-MIGRATION-REPORT.md` | §23–§25 |

---

## Phase 1 — TS Foundation + tooling

**Why:** Establish strict TS with JS coexistence and make the doc/contract generators TS-aware BEFORE any code converts (spec §8). Parent-owned.

**Deliverables:**
- `tsconfig.json` (strict per spec §8.1; `allowJs:true`, `checkJs:false`, `noEmit`, `noUncheckedIndexedAccess`, Next plugin)
- `package.json` `typecheck` script (`tsc --noEmit`) + `@types/react@18`, `@types/react-dom@18`, `@types/node`, typescript devDeps; eslint TS parser wired
- Route-discovery generators accept `route.{js,ts,tsx}` (the shared route-inventory used by `generate-api-inventory.mjs`, `generate-openapi.mjs`, `check-route-sql-guard.mjs`) — re-baselined, still green
- `next.config.js` version injection (`NEXT_PUBLIC_DASHCLAW_VERSION`) confirmed to survive

**Acceptance criteria:**
- `npm run typecheck` exists and exits 0 on the all-JS baseline (allowJs coexistence)
- `npm run lint` exits 0
- `npx next build` exits 0
- `npm run openapi:check`, `npm run api:inventory:check`, `npm run route-sql:check`, `npm run version:check`, `npm run version:sync:check` all exit 0 after the generator update
- A throwaway `app/lib/__ts_probe__.ts` typechecks then is removed (proves TS toolchain live); no `.ts` left behind
- `refactor/typescript-migration` branch checked out

**Mandatory commands:** `npm run typecheck`, `npm run lint`, `npx next build`, `npm run openapi:check`, `npm run api:inventory:check`, `npm run route-sql:check`, `npm run version:sync:check`

**Evidence required:** tsconfig contents; typecheck exit 0; build summary; each check exit code; `git branch --show-current`

**Dependencies:** Phase 0 (baseline)

---

## Phase 2 — Domain type architecture (PARENT-OWNED, single writer)

**Why:** One typed contract per domain, organized by boundary (spec §9). All shared types are parent-owned — no worker writes these.

**Deliverables:** `app/lib/types/identity.ts`, `governance.ts`, `actions.ts`, `pricing-finops.ts`, `x402.ts`, `db.ts` (or equivalent layout) covering spec §9.1–§9.6: branded ids (`OrganizationId`/`AgentId`/`ActionId`/`X402ProviderId`…), discriminated unions for guard decisions (allow|warn|require_approval|block) + 13 policy types + x402/action status; `SpendPeriod = '7d'|'30d'|'90d'`, `FinOpsLens='fleet'|'claude-code'` with explicit `claude-code`→`claude_code` response mapping note; `CurrencyCode`/`SpendAmount`; nullable-accurate DB row types.

**Acceptance criteria:**
- Type files compile under `npm run typecheck` (0 errors)
- Guard `DecisionType` + `GuardPolicyType` are discriminated unions covering all 13 policy types in `app/lib/guard.js`
- x402 distinguishes `provider` vs `provider_id` vs `endpoint_id` (no interchangeable typing)
- `lint` clean; no runtime files changed (types only)

**Mandatory commands:** `npm run typecheck`, `npm run lint`

**Evidence required:** `ls app/lib/types/`; the DecisionType/PolicyType/status unions; typecheck exit 0

**Dependencies:** 1

---

## Phase 3 — Runtime validation alignment

**Why:** TS types don't validate runtime input; align Zod schemas at every external boundary, infer TS from schemas (spec §10). Parent owns the shared schema modules; workers wire imports later.

**Deliverables:** Zod schemas for HTTP bodies/query/headers, API keys, JWT claims, webhook/Discord/Telegram/Stripe payloads, x402 provider+purchase, **centralized `process.env` schema** (spec §10 + tooling-lane env-validation finding), DB JSON columns, SDK/MCP/Code-Session ingest inputs; x402 §10.1 reject-list (negative/NaN/Infinity/unsupported currency/invalid provider-endpoint/client-risk-lowering); FinOps §10.2 period+lens validation preserving the intentional `claude-code` compat.

**Acceptance criteria:**
- New/updated schemas typecheck + lint clean
- x402 purchase schema rejects negative, NaN, Infinity amounts (unit test)
- env schema validates required vars at startup without weakening existing fallbacks
- No boundary that previously validated now skips validation (types did NOT replace runtime checks — spec §5.9)

**Mandatory commands:** `npm run typecheck`, `npm run lint`, `npx vitest run __tests__` (schema-scoped files only)

**Evidence required:** schema file list; the x402 reject-amount test output; typecheck exit 0

**Dependencies:** 2

---

## Phase 4 — Pricing & FinOps foundation (PARENT-OWNED money contract) — INTEGRATION GATE

**Why:** Pricing modules are pure, central to multiple cost surfaces, and have the highest tooling-coupling risk (spec §11). Parent owns billing/pricing/money/currency.

**Deliverables:** `app/lib/billing.ts`, `app/lib/claude-code/pricing.ts`, shared typed rate-card source preserving BOTH fallback semantics (billing unknown→$0+warn; analytics unknown→Sonnet FALLBACK), cache-aware primitives, custom-org pricing; `finops.repository.ts` + the x402-exclusion in `actions.repository.ts` cost-aggregation; **`scripts/refresh-model-pricing.mjs` updated** to target `.ts` files + preserve `MODEL_PRICING_GENERATED:*` markers (CRITICAL coupling); parity test ported (`rate-card-parity.test.ts`) and kept green until a ≥-strength shared-source test replaces it.

**Acceptance criteria:**
- `npm run typecheck` + `lint` clean
- `npx vitest run __tests__/unit/rate-card-parity.test.*` passes (Claude-model parity to 6 decimals)
- `node scripts/refresh-model-pricing.mjs` (DRY-RUN, no `--apply`) runs clean against the `.ts` files and reports markers found in both
- A test proves `estimateCost(_,_,'unknown-model')===0` AND `priceFor('unknown-model')===FALLBACK` (both fallbacks preserved)
- `Fleet = AgentLLM(x402_purchase excluded) + x402` and `getClaudeCodeSpend` returns `lens:'claude_code'` — unchanged (test)
- **Full gate** (this is an integration boundary): `npx vitest run` green
- No historical repricing; `real` cost_estimate + `numeric` cost_usd DB types unchanged

**Mandatory commands:** `npm run typecheck`, `npm run lint`, `npx vitest run`, `node scripts/refresh-model-pricing.mjs`

**Evidence required:** parity test output; refresh dry-run marker report; both-fallback test; vitest summary

**Dependencies:** 2, 3

---

## Phase 5 — Security-critical conversion (PARENT-OWNED identity + risk)

**Why:** Convert + strengthen identity, JWT/JWKS, replay, action-binding, guard, risk, audit, scanners before broad work (spec §12). Parent owns identity + risk contracts; workers may convert leaf scanners under direction.

**Deliverables:** `app/lib/identity-resolution.ts`, `identity.ts`, `agent-identity-resolve.ts`, `jwks-verifier.ts`, `act-binding.ts`, `guard.ts` (computeRiskScore + evaluateGuard + evaluatePolicy + evaluateWebhookPolicy), `guardrails/evaluator.ts`, `repositories/jti-replay.repository.ts`, `repositories/guard.repository.ts`, `promptInjection.ts`, `security.ts`; one typed `resolveAgentIdentity` contract; one typed risk result flowing to guard_decisions/action_records/x402/responses/UI.

**Acceptance criteria:**
- typecheck + lint clean
- `resolveAgentIdentity`: verified JWT `sub` overrides body; untrusted token never applies claims (test preserved/added)
- `computeRiskScore` integer 0–100; `effectiveRiskScore = max(server, agentReported)` — client cannot lower (test)
- `guard_decisions` INSERT remains awaited + throws `GUARD_AUDIT_PERSIST_FAILED` on failure (audit durability test)
- `evaluateGuard` still throws on missing `orgId` (tenant boundary test)
- Guard-domain tests pass: `npx vitest run __tests__` (guard/identity/replay-scoped)

**Mandatory commands:** `npm run typecheck`, `npm run lint`, `npx vitest run` (guard+identity+security scoped)

**Evidence required:** identity-override test; risk-max test; audit-persist-fail test; typecheck exit 0

**Dependencies:** 2, 3

---

## Phase 6 — x402 repository + API conversion (PARENT owns money + consistency)

**Why:** Convert x402 governance preserving the governance order, status lifecycle, redaction, and the action↔purchase consistency window (spec §13).

**Deliverables:** `app/lib/repositories/x402.repository.ts`; `app/api/x402/providers/route.ts`, `providers/[id]/route.ts`, endpoints route(s), `purchases/route.ts`; typed purchase lifecycle (proposed/blocked/pending/approved/running/succeeded/failed/partial) with explicit action-status↔execution-status mapping; SDK x402 methods' type defs; wallet/payment reference redaction preserved.

**Acceptance criteria:**
- typecheck + lint clean
- Governance order preserved (spec §13.2) — resolve identity→validate→resolve provider/endpoint→guard→persist decision→block/approve/create action→create purchase→agent executes→record outcome (test)
- DashClaw executes NO payment / holds NO wallet credential (assert no signing/transfer/private-key path) 
- wallet_reference/payment_reference masked before persist (test); x402_spend_limit allow/block by name OR provider_id preserved
- x402 tests pass: `npx vitest run __tests__` (x402-scoped); `npm run route-sql:check` exit 0
- Action↔purchase consistency strategy documented/tested (no NEW cross-table FK; spec §13.3)

**Mandatory commands:** `npm run typecheck`, `npm run lint`, `npx vitest run` (x402-scoped), `npm run route-sql:check`

**Evidence required:** governance-order test; redaction test; route-sql:check exit 0

**Dependencies:** 2, 3, 4, 5

---

## Phase 7 — Database repository conversion — INTEGRATION GATE

**Why:** Convert 49 repos in dependency order, preserving org_id scoping, parameterized SQL, idempotency, nullable + numeric-string semantics (spec §14). 7 NON-OVERLAPPING worker ownership groups.

**Deliverables (ownership groups — `app/lib/repositories/*.ts`):**
- Core Execution & Outcomes (actions/approvals/outcomes/workflow-runs)
- Agent Identity, Presence & Trust (agents/identities/registered-agents/pairings/reputation)
- Governance, Policies & Guardrails (guard/guardrails/compliance/assumptions) — guard/jti done in P5
- Configuration, Secrets & Integration (settings/governed-secrets/oauth/signing-keys/connections/tokens)
- Knowledge, Learning & Content (knowledge/learning/learningLoop/snippets/prompts/skill-scan-results)
- Capabilities, Permissions & Marketplace (capabilities/capability-access/workflow-templates/model-strategies/routing)
- Analytics, Monitoring & FinOps (analytics/integration-health/digest/finops [done P4]/code-sessions/code-session-handoffs)

**Acceptance criteria:**
- typecheck + lint clean
- Every converted repo preserves `WHERE org_id = ${orgId}` on tenant-owned queries (grep-verified per group)
- Neon `numeric` aggregates coerced via `Number()` before arithmetic (no string concat regressions)
- `npm run route-sql:check` exit 0 (repos remain SQL-owners, routes unaffected)
- **Full gate:** `npx vitest run` green; `npx next build` green
- No JSON.parse left unguarded in converted repos

**Mandatory commands:** `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run route-sql:check`, `npx next build`

**Evidence required:** org_id grep per group; numeric-coercion spot check; vitest + build summary

**Dependencies:** 2, 3, 5

---

## Phase 8 — API route conversion — INTEGRATION GATE

**Why:** Convert 242 active routes by domain group (archived excluded), preserving status codes, middleware expectations, shared identity/error helpers (spec §15). 12 NON-OVERLAPPING worker groups.

**Deliverables (route groups under `app/api/**/route.ts`, EXCLUDING `_archive`):** Governance & Guard (~34) · Core Action Lifecycle (~33) · Learning & Analytics (~29) · Knowledge/Prompts/Capabilities (~25) · Integrations & Webhooks (~23) · Workflows & Automation (~20) · Coding Context & Sessions (~16) · Drift & Compliance (~16) · Sessions/Settings/Team (~15) · Auth/Setup/Public (~13) · Billing/Usage/Ops (~12) · Scheduled & Maintenance (~12). All converge on `resolveAgentIdentity` + shared error contract.

**Acceptance criteria:**
- typecheck + lint clean
- `npm run route-sql:check` exit 0 (no NEW direct SQL; the 9 preexisting `sql.query()` routes not increased)
- `npm run api:inventory:check` + `npm run openapi:check` exit 0 (generators now TS-aware from P1; routes still discovered)
- Status codes + response shapes preserved (spec §15.7) — public-compat tests pass
- All action-creating routes use the typed identity resolver (grep)
- **Full gate:** `npx vitest run` green; `npx next build` green

**Mandatory commands:** `npm run typecheck`, `npm run lint`, `npm run route-sql:check`, `npm run api:inventory:check`, `npm run openapi:check`, `npx vitest run`, `npx next build`

**Evidence required:** route-sql:check exit 0; api-inventory/openapi exit 0; identity-resolver grep; vitest + build summary

**Dependencies:** 2, 3, 5, 7

---

## Phase 9 — UI / TSX conversion — INTEGRATION GATE

**Why:** Convert ~128 React pages/components to TSX, preserving design, tokens, the `/spend` active-state, and `/spend/code` token-resolved brand-orange (spec §16). 10 NON-OVERLAPPING worker groups.

**Deliverables (`.jsx`→`.tsx` groups):** Governance Core Pages · Spend & FinOps (spend/*, charts) · Security & Risk · Mission Control & Observability · Code Sessions & Projects · Settings/Config/Identity · Shared UI Primitives & Layout · Page-Specific Component Trees (~38) · Data/Realtime Hooks · Recharts & Chart Integration. Props/responses/event-handlers/chart-data typed; unions rendered exhaustively.

**Acceptance criteria:**
- typecheck + lint clean
- `npx next build` exit 0
- Preserve current design; NO new hardcoded hex (token-first); `/spend` nav active-state behavior preserved; `/spend/code` brand-orange still token-resolved (`getComputedStyle`) — visual/browser check (trust-prior + screenshot)
- **Full gate:** `npx vitest run` green
- No `any` on API response props in converted pages (spot-grep)

**Mandatory commands:** `npm run typecheck`, `npm run lint`, `npx next build`, `npx vitest run`

**Evidence required:** build summary; `/spend/code` screenshot path; active-state confirmation; typecheck exit 0

**Dependencies:** 2, 3

**Notes:** Read `.impeccable.md` before any visual change. The 5+ preexisting hardcoded `#f97316` chart files are PREEXISTING design debt — note but do NOT fix unless approved (surgical scope).

---

## Phase 10 — Integrations, SDK, scripts

**Why:** Convert actively-maintained integrations; keep Node + Python SDK public contracts stable; leave stable ops `.mjs` as documented exceptions (spec §17). Parent owns the Node-SDK public-contract decision.

**Deliverables:** integrations TS (discord/telegram/webhooks/stripe/email/mcp/openclaw/hermes/notification adapters) preserving webhook DNS-rebinding + HMAC + fire-and-forget-never-throw; Node SDK public surface stable (internal conversion ONLY behind a passing `instanceof` + nested-namespace contract test — else keep `sdk/dashclaw.js` as a documented JS exception); `mcp-server/tools.js` schemas unbroken; ops `.mjs` (~60) listed as exceptions; Python SDK NOT converted.

**Acceptance criteria:**
- typecheck + lint clean
- `npm run sdk:integration` exit 0 (Node SDK contract harness, 5 cases)
- `npm run sdk:integration:python` exit 0 (93 tests)
- `npm run version:sync:check` exit 0 (platform+node+python versions still aligned)
- `npm run contracts:check` exit 0
- Node SDK `instanceof`/nested-namespace bridge proven intact OR SDK internals left as JS exception (documented)

**Mandatory commands:** `npm run typecheck`, `npm run lint`, `npm run sdk:integration`, `npm run sdk:integration:python`, `npm run version:sync:check`, `npm run contracts:check`

**Evidence required:** sdk:integration output; version:sync:check exit 0; SDK-bridge decision + evidence

**Dependencies:** 2, 3, 5

---

## Phase 11 — Test migration + regression coverage

**Why:** Convert tests to TS where practical; add the spec §18 regression matrix (identity/security, actions/governance, pricing/FinOps, x402, UI/compat). Workers avoid editing production files.

**Deliverables:** TS test files + new regression tests covering spec §18.1–§18.5 (forged identity, JWT-override, replay, cross-tenant, secret redaction, authoritative-risk persistence, guard-persist-failure, idempotent action creation, every model rate, cache rates, unknown-model behavior, x402-exclusion, Fleet equation, x402 negative/NaN/blocklist/approval/idempotency/redaction/cross-tenant + agent-executes-payment-boundary, FinOps typing, spend pages, no-repricing, no-rate-card-drift).

**Acceptance criteria:**
- typecheck + lint clean
- `npx vitest run` green with NEW tests added (count increases vs baseline 2846)
- Each spec §18 category has ≥1 explicit test (checklist mapped in evidence)
- No assertions weakened to pass (spec §18 closing rule)

**Mandatory commands:** `npm run typecheck`, `npm run lint`, `npx vitest run`

**Evidence required:** new test count vs 2846 baseline; §18 category→test mapping; vitest summary

**Dependencies:** 4,5,6,7,8,9,10

---

## Phase 12 — Unsafe-typing audit

**Why:** The dragnet (spec §19). Review every `any`/`unknown`/`as`/`!`/`@ts-*`/`eslint-disable`/`JSON.parse`/`process.env`/`Record<string,unknown>`, extra scrutiny on identity/org/guard/money/currency/x402/db-JSON/webhook/SDK.

**Deliverables:** `.supergoal/unsafe-typing-audit.md` enumerating every occurrence with verdict (justified+documented / narrowed / removed); narrow suppressions documented per spec §8.3; no `any` across security/tenancy/pricing/payment boundaries.

**Acceptance criteria:**
- typecheck + lint clean
- Zero unexplained suppressions remain (grep + audit doc reconciled)
- No `any` on identity/org/guard/money/x402 boundaries (grep evidence)
- Each remaining `unknown` is narrowed before use

**Mandatory commands:** `npm run typecheck`, `npm run lint`

**Evidence required:** suppression census before/after; audit doc; boundary grep

**Dependencies:** 4–11

---

## Phase 13 — Parallel adversarial review

**Why:** Independent reviewers attempt to DISPROVE completeness across 15 dimensions (spec §20). Read-only until findings accepted by parent.

**Deliverables:** `.supergoal/adversarial-review.md` — findings (severity, file paths, evidence, failure/exploit scenario, fix, verification) for: type correctness, runtime validation, identity/authz, tenant isolation, guard/risk, audit durability, DB consistency, pricing, FinOps accounting, x402 governance + payment boundary, API compat, React correctness, test quality, build/deploy compat, dead-code/duplicate-impl. Every confirmed CRITICAL/HIGH fixed.

**Acceptance criteria:**
- All 15 dimensions reviewed; findings cite real file+line (reject evidence-free claims)
- Every confirmed critical/high fixed; re-verified
- No duplicate JS+TS implementation of the same module remains (grep both extensions)
- typecheck + lint clean after fixes

**Mandatory commands:** `npm run typecheck`, `npm run lint`, `npx vitest run` (post-fix)

**Evidence required:** review doc with per-dimension verdicts; duplicate-impl grep; fixes + re-verify

**Dependencies:** 1–12

---

## Phase 14 — Polish, Harden, Docs & Final report

**Why:** Enforce "every aspect is perfect" + the full completion gate + accurate docs + the spec §25 final report. Parent-owned.

**Sub-passes (each produces evidence):**
- [ ] **UX & copy** — no debug placeholders in converted UI
- [ ] **States** — empty/loading/error/unauthorized intact for converted surfaces
- [ ] **Edges** — money edge inputs, nullable rows, long inputs
- [ ] **Security** — input validation present at every boundary; no secrets in client bundle; tenant isolation grep
- [ ] **A11y** — converted pages keyboard/focus/contrast unchanged from baseline
- [ ] **Perf** — no new N+1; no megabyte client bundle regressions (build output)
- [ ] **Diff review** — `bash .supergoal/repo-state.sh added-lines <baseline>` reviewed for stray debug logs / session TODOs / dead imports
- [ ] **Regression sweep** — FULL gate
- [ ] **Docs** — run the `dashclaw-ship` accuracy sweep; docs describe the TS architecture; `version:sync:check` green
- [ ] **Final report** — `.supergoal/FINAL-MIGRATION-REPORT.md` per spec §25 (every field)

**Acceptance criteria (full completion gate — spec §23/§24):**
- `npm run typecheck` 0 errors · `npm run lint` clean · `npx vitest run` green · `npm run test:api` (against a started server, or noted preexisting) · `npx next build` green · `npm run docs:check` · `npm run contracts:check` · `npm run openapi:check` · `npm run api:inventory:check` · `npm run route-sql:check` · `npm run version:sync:check` · `npm run sdk:integration` · `npm run sdk:integration:python` · `npm run scripts:check-syntax` — all exit 0 (`startup:smoke` noted preexisting on this host)
- No duplicate JS+TS implementations; no unexplained suppressions; all spec §24 invariants verified (identity/risk/tenancy/audit/x402/FinOps/pricing)
- `FINAL-MIGRATION-REPORT.md` lists every intentional JS/MJS exception

**Mandatory commands:** `npm run typecheck`, `npm run lint`, `npx vitest run`, `npx next build`, `npm run docs:check`, `npm run contracts:check`, `npm run openapi:check`, `npm run api:inventory:check`, `npm run route-sql:check`, `npm run version:sync:check`, `npm run sdk:integration`, `npm run sdk:integration:python`, `npm run scripts:check-syntax`

**Evidence required:** every gate command exit code + last lines; final report; `/spend/code` screenshot; exceptions list; `repo-state.sh added-lines` cleanliness counts

**Dependencies:** 1–13
