# Phase 3 — External boundary validation inventory

DashClaw's authoritative runtime-validation layer is **hand-rolled** (`app/lib/validate.js`,
`app/lib/contracts/*`), NOT broad Zod (only 2 files imported zod pre-Phase-3). Per spec §10
("Use Zod **or an existing authoritative schema layer**") + behavior-preservation, this layer is
PRESERVED, not rip-and-replaced. TS types are inferred from it during per-route conversion
(Phase 8); the env contract is the one genuinely-missing piece added now.

## Authoritative validators already present (app/lib/validate.js)
- `validateGuardInput`, `validatePolicy`, `validateActionRecord`, `validateActionOutcome`,
  `validateOpenLoop`, `validateAssumption(Update)`, `validateX402Purchase`, `isValidWebhookUrl`,
  `enforceFieldLimits`. Plus `app/lib/contracts/{http,notifications}.js`, `app/lib/validators/sync.js`,
  `app/lib/capability-contracts.js`, parsers (`claude-code/parser.js`, `codex/parser.js`).

## §10.1 x402 — ALREADY SATISFIED (preserve, do not duplicate)
`validateX402Purchase` (validate.js:517) rejects: non-finite (NaN/Infinity), negative, over-ceiling
spend (explicitly NOT `Number(x)||0`); validates currency (2-16 alnum), risk_score 0-100,
confidence_score finite; enforces field length limits. Covered by `__tests__/unit/validate-x402.test.js`
(rejects negative / Infinity / NaN / risk out of range) + `x402-purchases-hardening.route.test.js`.

## §10 boundaries → where validation lives (wired per route in Phase 8)
| Boundary | Authoritative validator |
|---|---|
| Guard input | `validateGuardInput` (+ GUARD_INPUT_SCHEMA in guard route) |
| Action create/outcome | `validateActionRecord` / `validateActionOutcome` |
| x402 purchase | `validateX402Purchase` |
| Policy CRUD | `validatePolicy` |
| Webhook URL (SSRF) | `isValidWebhookUrl` + `app/lib/url-safety.js` |
| Notifications | `app/lib/contracts/notifications.js` (zod) |
| Sync payloads | `app/lib/validators/sync.js` (zod) |
| HTTP envelopes | `app/lib/contracts/http.js` |
| **process.env** | **`app/lib/env.ts` (NEW — Phase 3)** |
| API keys / JWT claims | middleware.js + jwks-verifier.js (Phase 5) |
| Discord/Telegram/Stripe | integration routes (Phase 10) |
| Code-session ingest | claude-code/parser.js |

## Added this phase
- `app/lib/env.ts` — typed Zod env contract; `validateEnv()` (non-throwing, opt-in) + `getEnv()`
  (typed accessor, no stripping). **Behavior-preserving**: all vars optional, no import-time throw —
  hard startup enforcement deferred (would change behavior; operator decision).
- `__tests__/unit/env-schema.test.js`.

## Deferred to later phases (not weakening — sequencing)
- Per-route schema wiring + type inference from validators → Phase 8 (each route converts).
- Webhook/Discord/Telegram/Stripe payload schemas → Phase 10 (integration conversion).
- Wiring `validateEnv()` into a hard startup gate → operator decision (behavior change).
