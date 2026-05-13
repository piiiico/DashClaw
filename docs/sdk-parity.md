---
source-of-truth: true
owner: SDK Lead
last-verified: 2026-04-13
doc-type: architecture
---

# SDK Parity Matrix (Node vs Python)

## Current Policy

The canonical SDK policy is defined in:

- [SDK Consolidation RFC](./rfcs/2026-04-07-sdk-consolidation.md)
- [SDK Migration Matrix](./planning/2026-04-07-sdk-migration-matrix.md)

In short:

- `dashclaw` is the canonical SDK surface for new product work.
- `dashclaw/legacy` is a compatibility layer for older integrations.
- Python remains broader today, but should converge around the same platform model and HTTP contracts.

## What This Document Tracks

This document tracks:

1. which surface is canonical,
2. which surface is compatibility-only,
3. where major domains currently live,
4. where remaining parity or consolidation work is needed.

### Scope note: operator-surface routes

The `/api/hosted/*` route family (provisioning, admin inspect/delete, cleanup sweeper) is operator-facing and intentionally NOT exposed through either the Node or Python SDKs. These endpoints exist only when `DASHCLAW_HOSTED=true` and produce the API key that downstream SDKs consume. No parity tracking is required.

## SDK Surfaces

| Surface | Entry point | Role |
|---|---|---|
| Canonical Node SDK | `sdk/dashclaw.js` / `import { DashClaw } from 'dashclaw'` | Primary SDK surface for new work |
| Legacy Node SDK | `sdk/legacy/dashclaw-v1.js` / `import { DashClaw } from 'dashclaw/legacy'` | Compatibility layer for older integrations |
| Python SDK | `sdk-python/dashclaw/client.py` | Broad current surface; should converge toward the same canonical platform model |

## Canonical Node Surface

The canonical Node SDK already includes the core runtime and a meaningful portion of the execution surface:

- guard, actions, assumptions, approvals,
- loops, signals, learning, scoring,
- messaging, handoffs, security scanning, feedback, threads, sync,
- sessions and action graph,
- workflow templates,
- model strategies,
- knowledge collections,
- capability registry,
- canonical `execution.capabilities.invoke(...)` for governed runtime execution,
- canonical `execution.capabilities.test(...)`,
- canonical `execution.capabilities.getHealth(...)`,
- canonical `execution.capabilities.listHealth(...)`,
- canonical `execution.capabilities.getHistory(...)`.

This is the surface new SDK-facing product work should target first.

## Legacy Node Surface

The legacy Node SDK still contains a broader set of compatibility methods, including areas such as:

- pairing and identity flows,
- routing,
- compliance,
- activity logs,
- webhooks,
- older convenience wrappers and historical method shapes.

Legacy is preserved for compatibility. It is not the preferred entry point for new design work.

Where capability-runtime overlap exists, legacy should expose flat compatibility wrappers that call the same HTTP contracts as the canonical `execution.capabilities.*` surface.

## Python Surface

The Python SDK currently remains broader than the canonical Node SDK.

For the capability-runtime domain, Python now exposes the same route-contract surface as the canonical Node SDK:

- `list_capabilities(...)`
- `create_capability(...)`
- `get_capability(...)`
- `update_capability(...)`
- `invoke_capability(...)`
- `test_capability(...)`
- `get_capability_health(...)`
- `list_capability_health(...)`
- `get_capability_history(...)`

That is acceptable temporarily, but it should not define future product direction on its own. New design work should still align with:

- the canonical object model,
- the canonical HTTP contracts,
- the SDK consolidation policy.

## Domain Status Matrix

| Domain | Canonical Node | Legacy Node | Python | Status |
|---|---|---|---|---|
| Guard / actions / approvals | Yes | Yes | Yes | Stable, canonical in main SDK. Approvals use `POST /api/approvals/[actionId]` (shared by browser, CLI, `/approve` mobile PWA, SDK polling). Phase 1 agent attribution (`agent_id`, `agent_name`) supported in both SDKs — pass in constructor or per-call body. Phase 2 will add JWKS verification. |
| Action outcome (durable execution finality) | Phase 1-2: HTTP only, Node wrapper pending | n/a | Phase 1-2: HTTP only, Python wrapper pending | `POST/GET /api/actions/:id/outcome` shipped in Phase 1; cron sweep `/api/cron/outcome-sweep` + `lost_confirmation` signal shipped in Phase 2. SDK wrappers (`reportActionOutcome` / `getActionOutcome`) follow in Phases 3 + 4. See `docs/architecture/durable-execution-finality.md`. |
| Sessions / action graph | Yes | Partial overlap | Yes | Stable, canonical in main SDK |
| Loops and assumptions | Yes | Yes | Yes | Canonical in main SDK |
| Workflows | Yes | Historical overlap | Yes | Canonical in main SDK, with Python route-contract parity for template CRUD, launch, and execute. `POST /api/workflows/draft` NL-to-workflow endpoint also exposed |
| Capabilities | Yes | Yes, as flat compatibility wrappers for current overlap | Yes | Canonical in main SDK, with Python route-contract parity for registry plus runtime methods. Legacy should only shim to the same routes |
| Model strategies | Yes | Limited overlap | Yes | Canonical in main SDK, with Python route-contract parity and contract-enforced runtime surface |
| Knowledge collections | Yes | Limited overlap | Yes | Canonical in main SDK, with Python route-contract parity and explicit API/SDK contract coverage |
| Messaging / handoffs / threads | Yes | Yes | Yes | Canonical in main SDK |
| Scoring profiles / dimensions | Yes | No | Yes | Canonical in main SDK (`createScoringProfile`, `scoreWithProfile`, `batchScoreWithProfile`, calibration) |
| Risk templates | Yes | No | Yes | Canonical in main SDK |
| Evaluations (scorers / scores / runs) | Yes | Limited overlap | Yes | Canonical in main SDK |
| Prompt management (templates / versions / render) | Yes | Limited overlap | Yes | Canonical in main SDK |
| Learning analytics (velocity / curves / lessons / maturity) | Yes | Limited overlap | Yes | Canonical in main SDK |
| Security scanning (prompt injection / content) | Yes | Yes | Yes | Canonical in main SDK |
| Feedback | Partial (via actions outcome) | Yes | Yes | Compatibility-heavy; low-priority canonical promotion |
| Drift detection | No canonical wrapper yet | Yes | Yes | Admin-heavy; future promotion candidate |
| Pairing / identities | No canonical wrapper yet for full shape | Yes | Yes | Compatibility-heavy, future promotion candidate |
| Routing | No canonical wrapper yet for full shape | Yes | Yes | Future promotion candidate |
| Compliance | No canonical wrapper yet for full shape | Yes | Yes | Remain compatibility and admin-heavy for now |
| Webhooks / activity logs | No canonical wrapper yet for full shape | Yes | Yes | Remain compatibility and admin-heavy for now |
| Preferences / digest / ideas | No | Yes | Yes | Low-priority consolidation |

## Non-SDK Surfaces (Operational)

These are reachable via HTTP but are not intended as SDK methods. Documented here so SDK maintainers don't accidentally wrap them:

| Surface | Endpoint(s) | Where it belongs |
|---|---|---|
| Doctor (self-host diagnostics) | `GET /api/doctor`, `POST /api/doctor/fix` | CLI (`dashclaw doctor`) + local script (`npm run doctor`) |
| MCP server | `POST /api/mcp` (Streamable HTTP) | `@dashclaw/mcp-server` npm package (stdio + HTTP) |
| Analytics dashboard | `GET /api/analytics` | Dashboard frontend only |
| Guard decisions audit log | `GET /api/guard/decisions` | Policy Builder ActivityTab; no SDK wrapper yet |
| Agent governance profile | `GET /api/agents/[agentId]/profile` | `/agents/[agentId]` dashboard page aggregator |

If any of these later need first-class SDK exposure, promote them into the matrix above.

## Cross-SDK Integration Suite

Critical-domain contract coverage is validated against a shared harness:

- Shared fixture: `docs/sdk-critical-contract-harness.json`
- Node harness runner: `scripts/check-sdk-cross-integration.mjs` (`npm run sdk:integration`)
- Python harness test: `sdk-python/tests/test_ws5_m4_integration.py` (`npm run sdk:integration:python`)

## Version Compatibility Policy

- Canonical Node SDK (`sdk/dashclaw.js`): primary target for new product work.
- Legacy Node SDK (`sdk/legacy/dashclaw-v1.js`): compatibility maintenance only.
- Python SDK (`sdk-python/dashclaw/client.py`): broad surface; converge by domain over time.
- Node SDK requires Node 18+. Python SDK supports Python 3.7+.

## Notes

- Python method naming uses `snake_case`; Node uses `camelCase`.
- Legacy behavior may preserve older signatures for compatibility even where the canonical SDK uses newer semantics.
- New feature design should start from route contracts and canonical SDK grouping, not from legacy method history.

## Related Documents

- [SDK Consolidation RFC](./rfcs/2026-04-07-sdk-consolidation.md)
- [SDK Migration Matrix](./planning/2026-04-07-sdk-migration-matrix.md)
- [Platform Object Model](./architecture/platform-object-model.md)
