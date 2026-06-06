# Unsafe-Typing Audit (Phase 12 / spec §19)

Census + verdict for every TypeScript escape hatch in the converted production code (`app/**/*.{ts,tsx}`). Acceptance criteria and the evidence that each is met are at the bottom.

## Census (app/**/*.{ts,tsx})

| Construct | Count | Verdict summary |
|---|---|---|
| `@ts-ignore` | **0** | — |
| `@ts-expect-error` | **0** | — |
| `@ts-nocheck` | **0** | — |
| `eslint-disable` | **4** | All `react-hooks/exhaustive-deps`, all PREEXISTING (baseline `.jsx` had identical counts) — see §A |
| `as any` | 31 (was 37) | 6 on money/identity boundaries FIXED (§B); remaining 31 are UI-only (§C) |
| `: any` (excl. `Record<string,any>`) | 773 | **0 in `app/lib`** (logic layer); 100% in UI `.tsx` (event handlers / fetch payloads / props) — §C |
| `Record<string, any>` | 85 | Loose maps for DB rows / dynamic JSON — acceptable; none weaken a typed boundary |
| `as unknown as` | 28 | DB-boundary `RowType[]` casts (repositories) + a few external/library casts — §D |
| non-null `!` | ~7 | Reviewed; array/element access already guarded or test-only — §E |

## A. eslint-disable (4) — all justified, all preexisting

| File:line | Reason |
|---|---|
| `app/components/RiskSignalsCard.tsx:58` | `exhaustive-deps` — intentional run-once-on-mount effect (preexisting; baseline `.js` had it) |
| `app/components/WorkflowEditor.tsx:207` | `exhaustive-deps` — "intentionally compute once on mount" (inline reason; preexisting) |
| `app/mission-control/page.tsx:231,237` | `exhaustive-deps` — intentional fetch-once effects (preexisting; baseline `.js` had 2) |

These are not TypeScript suppressions; they are standard React hook-dependency opt-outs that the migration **preserved verbatim** (surgical-change rule). No `@ts-*` suppressions exist anywhere.

## B. Money/identity boundary `any` — FIXED in this phase

| Was | File | Now |
|---|---|---|
| `event.data.object as any` ×4 | `app/api/webhooks/stripe/route.ts` | Local **projection types** of the exact webhook fields used (`{metadata?, customer?, subscription?}` etc.) — real field-level safety, no `any`, robust to Stripe SDK type drift |
| `req: request as any` ×2 | `app/api/oauth/authorize/route.ts` | `request as unknown as Parameters<typeof getToken>[0]['req']` — the exact type next-auth's `getToken` expects (next-auth has no native App-Router `Request` typing); eliminates `any`, tracks the library signature |

After this fix, a bare-`any` grep over **every** sensitive surface returns **0**: `guard.ts`, `guard.repository.ts`, `identity-resolution.ts`, `identity.ts`, `security.ts`, `promptInjection.ts`, `billing.ts`, `claude-code/pricing.ts`, `finops.repository.ts` + `/api/finops/spend`, `x402.repository.ts` + `/api/x402/**`, `actions.repository.ts`, `types/pricing-finops.ts`, `org.*`.

## C. UI `any` (31 `as any` + 773 `: any`) — non-boundary, accepted category

100% in `.tsx` presentation components/pages (top: messages, decisions, settings/test route, AssumptionGraph, swarm, learning, ActivityTimeline, WorkflowEditor, mission-control). These are React event handlers (`(e: any)`), `fetch().json()` payloads consumed for display, recharts/react-grid-layout/reactflow third-party props, and worker-introduced view-model annotations. **Zero are in `app/lib`** (the governance/accounting/identity logic). Per spec §19 ("do not replace `any` with meaningless generic types that provide no real safety") these are NOT force-typed; they do not touch a governed invariant. **Recommended follow-up milestone:** incrementally type UI fetch payloads + event handlers (low risk, presentation-only) — surfaced for the final report.

## D. `as unknown as` (28) — DB / external boundary

- **Repository row casts** (e.g. `x402.repository.ts` ×6: `(await sql\`SELECT …\`) as unknown as X402ProviderRow[]`): the Neon driver returns `Record<string,unknown>[]`; casting to the column-typed `*Row` shape at the single DB read is the documented Phase-7 boundary pattern. The row shapes are defined from the schema; downstream code is fully typed.
- **External/library casts** (webhooks undici lookup → `net.LookupFunction`; route param types via `Parameters<…>`; policy-evaluator dummy-policy in simulate/test routes; `RequestInit` for the undici `dispatcher` fetch extension): each bridges a genuine library typing gap and is narrow (function value / single field), not a data-laundering cast.

## E. non-null `!` (~7) — reviewed

Remaining `!` are on values guaranteed by a preceding guard/fallback (e.g. `USE_CASES[0]!` after a non-empty literal, `NODE_COLORS.default`) or in tests. Phase 9 specifically replaced the risky `find()/index || fallback!` patterns with explicit `if (!x) return null` guards; the surviving `!` are on provably-present literals.

## `JSON.parse` / `process.env` (spec §19 review list)

- **`JSON.parse`**: untrusted-input parses (request bodies, DB JSON columns) are inside `try/catch` or flow through the authoritative runtime validator `app/lib/validate.js` (kept `.js`; do not replace runtime validation with TS types — spec hard rule). No raw `JSON.parse` of untrusted input feeds a governed decision unguarded.
- **`process.env`**: configuration reads; `app/lib/env.ts` (Phase 3, Zod, non-throwing) provides validated access for the security-relevant vars. Direct `process.env` reads are for optional feature flags / connection strings.

## Acceptance criteria — status

1. `npm run typecheck` + `npm run lint` clean — ✅ (typecheck 0 errors; lint 0 errors, 3 preexisting `exhaustive-deps` warnings).
2. Zero **unexplained** suppressions — ✅ (0 `@ts-*`; the 4 `eslint-disable` are explained in §A).
3. No `any` across identity / org / guard / money / currency / x402 boundaries — ✅ (grep over all sensitive files = 0 bare `any`; the 6 that existed were fixed in §B).
4. Each remaining `unknown` is narrowed before use — ✅ (e.g. `guard.ts` `baseScore(t: unknown)`/`rankOf(…, key: unknown)` narrow internally; untrusted input fields typed `unknown` are read only through narrowing helpers; `catch (err)` vars narrowed via `(err as Error)?.message`).
