SUPERGOAL_PHASE_START
Phase: 2 of 14 — Domain type architecture (PARENT-OWNED)
Task: Author shared, domain-organized TypeScript contracts (identity, governance, actions, pricing/finops, x402, db).
Type: brownfield, refactor
Mandatory commands: npm run typecheck, npm run lint
Acceptance criteria: 4
Evidence required: app/lib/types listing, the decision/policy/status unions, typecheck exit 0
Depends on phases: 1

## Why
One typed contract per domain prevents drift and cross-wiring. These are PARENT-OWNED — single writer (the parent session). No worker writes domain types.

## Work
- See ROADMAP.md "Phase 2". Authoritative: spec §9 (§9.1 identity/tenancy, §9.2 governance, §9.3 actions/outcomes, §9.4 pricing/finops, §9.5 x402, §9.6 db contracts).
- Create `app/lib/types/{identity,governance,actions,pricing-finops,x402,db}.ts` (or equivalent; do NOT create one giant global file).
- Branded ids (OrganizationId/AgentId/ActionId/X402ProviderId/X402EndpointId…). Discriminated unions: DecisionType (allow|warn|require_approval|block); GuardPolicyType covering all 13 types in app/lib/guard.js (risk_threshold, require_approval, block_action_type, protected_path, rate_limit, webhook_check, non_fabrication, behavioral_anomaly, semantic_check, permission_escalation, green_contract, branch_freshness, x402_spend_limit); ActionStatus; x402 execution status.
- `type SpendPeriod = '7d'|'30d'|'90d'`; `type FinOpsLens='fleet'|'claude-code'` + an explicit mapping note that the response label is `claude_code` (do NOT conflate).
- x402: distinct `X402ProviderId` / `X402EndpointId` / provider-name types (never interchangeable). CurrencyCode + SpendAmount. Nullable-accurate DB row types (model `real` cost_estimate as number, `numeric` cost_usd as string-coerced).

## Acceptance criteria (all must pass — verify each in transcript)
- Type files compile under `npm run typecheck` (0 errors)
- GuardPolicyType discriminated union covers ALL 13 policy types in app/lib/guard.js
- x402 types keep provider / provider_id / endpoint_id distinct (not interchangeable)
- `npm run lint` clean; no runtime/behavior files changed (types only)

## Mandatory commands (run each, surface last ~10 lines + exit code)
- npm run typecheck
- npm run lint

## Evidence required in transcript
- `ls app/lib/types/`; the DecisionType/GuardPolicyType/status union definitions; typecheck exit 0

## Notes
PARENT-OWNED single-writer phase. Types only — zero behavior change.
