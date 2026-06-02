# DashClaw Sync Audit — Implementation Pass — 2026-06-02

Implements fixes from `SYNC_AUDIT.md`. Audit-only items became real, tested changes. Scope was protected: **no** OAuth connector, MCP, auth, middleware, or billing files were touched. No schema changes were needed, so **no migration** was generated.

## Verification (run before writing this report)

- `npm run lint` → **clean** (0 errors; 2 pre-existing `react-hooks/exhaustive-deps` warnings in untouched code on `capabilities/[capabilityId]/page.jsx:90,119`).
- `npx vitest run` (full suite) → **2479 passed, 5 skipped, 0 failed** (306 files).
- `npx next build` → **succeeded**; full route manifest emitted, including the new `/doctor` route.
- `git diff` reviewed → only audit-scoped files changed; secret-pattern scan of the diff returned nothing.

**28 new/updated test cases** were added across 7 files asserting real fields, statuses, outputs, permissions, and error paths (not mock-echo) — including a UI↔backend contract test that compiles every policy type and runs it through the real `validatePolicy`.

---

## Implemented findings

### High

| # | Finding | Implementation | Tests |
|---|---------|----------------|-------|
| H1 | **Capability `invoke` had no UI** | New `app/capabilities/[capabilityId]/components/CapabilityInvokePanel.jsx` (guided form + advanced JSON, `agent_id`/`declared_goal` inputs, renders every structured response: success+result+audit link, blocked_by_policy, pending_approval, quota_exceeded, circuit_breaker_open, access_denied, execution errors). Wired into `app/capabilities/[capabilityId]/page.jsx` with an "Invoke" toggle; POSTs to the real `/invoke`, refreshes health+history. | `capability-invoke-panel.test.jsx` (5), `capability-detail.page.test.jsx` (updated) |
| H2 | **Workflow "Launch" ran no steps** | `app/workflows/[templateId]/page.jsx` button now calls `/execute` (the governed step executor), navigates to the run timeline on any produced run, and surfaces blocked/quota/no-steps inline. `/launch` left intact for non-UI callers. | Verified via `next build` + the `/execute` route contract (see *Test gaps*) |
| H3 | **Compliance evidence tiles read wrong keys (3/4 showed 0)** | `app/compliance/page.js` now reads `guard_decisions_total` / `guard_decisions_blocked` / `action_records_total` (matches `app/api/compliance/evidence/route.js`). | Verified against the route's response shape |
| H4 | **Assumptions filters/counters read a nonexistent `status`** | New shared `app/lib/assumptions-status.js` (`deriveAssumptionStatus`, filter options); `app/assumptions/page.js` derives status from the real integer `validated`/`invalidated` columns, filters client-side (incl. the "Invalidated" tab the API can't filter), and counts from the full set. | `assumptions-status.test.js` (5) |
| H5 | **API keys silently always `admin`** | New shared `app/lib/apiKeyRoles.js`; `app/api/keys/route.js` validates + honors `role` (`admin`/`member`, matching the `api_keys_role_check` constraint), returns/logs it; `app/api-keys/page.js` adds a role selector and shows each key's role badge. Default stays `admin` for backward compatibility with non-UI callers. | `keys.route.test.js` (+4: default, member, invalid→400, INSERT binding) |
| H6 | **Policy builder omitted 4 enforced types** | Unified `POLICY_TYPE_OPTIONS` (all 11) in `app/policies/lib/policyFormModel.js`, used by both `CustomTab.jsx` and `generate/page.jsx`. Added real rule-builder inputs (`PolicyRuleBuilderSection.jsx`), compile/decompile/summary, and `formatRules` for `behavioral_anomaly`, `permission_escalation`, `green_contract`, `branch_freshness`. | `policy-types-coverage.test.js` (6, incl. FE→`validatePolicy` contract for all types) |
| H7 | **DLP scanner had no UI** | New `app/components/SecurityScanners.jsx` mounted on `/security` — paste text → `POST /api/security/scan`, renders findings + redacted text. | `security-scanners.test.jsx` (3) |
| H8 | **Prompt-injection scanner had no UI** | Same component (mode toggle) → `POST /api/security/prompt-injection`, renders risk/recommendation, plus a recent-scans list from the `GET`. | `security-scanners.test.jsx` |
| H9 | **Code-session alerts were a dead-end counter** | New `app/components/CodeSessionAlertsPanel.jsx` mounted on `/code-sessions` — lists alerts (severity, kind, body, link to the session), "Mark all read" → `POST /alerts/read-all`. | `code-session-alerts-panel.test.jsx` (3) |
| H10 | **Doctor self-heal had no dashboard UI** | New `app/components/DoctorPanel.jsx` + `app/doctor/page.js` — `GET /api/doctor`, checks grouped by category with status badges, per-check "Fix" → `POST /api/doctor/fix`, swaps in the recheck. Added to nav. | `doctor-panel.test.jsx` (2) |
| H11 | **`/evaluations` unreachable from nav** | Added `/evaluations` (and `/doctor`) to `app/components/Sidebar.js`. | Verified via `next build` |

### Medium / enum

| Finding | Implementation |
|---------|----------------|
| Webhook dropdown omitted approval events | `app/webhooks/page.js` `EVENT_TYPES` now includes `approval_pending`/`approval_granted`/`approval_denied` (matches `VALID_EVENT_TYPES`). |
| Decisions ledger lacked `pending_approval` filter | `app/decisions/page.js` status options include `pending_approval` (humanized labels). |
| Capability registry health filter omitted `failing`/`untested` | `CapabilityRegistryFilters.jsx` now lists all `deriveStatus()` values. |
| Capability edit `health_status` dropdown omitted runtime values | `CapabilityBasicsSection.jsx` adds `untested`/`failing`. |

---

## Not fixed this pass (precise next steps)

These remain from `SYNC_AUDIT.md`. Each route exists and was confirmed; only the UI is missing.

- **Secrets rotation UI (High).** Routes: `app/api/secrets/route.js` (GET/POST), `[id]/route.js` (PATCH/DELETE), `rotation-due/route.js`. *Next step:* a new `app/secrets/page.js` + client panel — list, create (name/agent_id/rotation_interval_days/notes), per-row "Mark rotated"/delete, and a "rotation due" banner from `/api/secrets/rotation-due`; add to the Configure nav. No schema change.
- **Skill safety scanner UI (High).** Routes: `app/api/skills/scan/route.js` (POST), `scans/[id]/route.js` (GET). *Next step:* a "Scan a skill" panel (file/paste → POST → findings/passed) under `/security`, mirroring `SecurityScanners.jsx`; link to scan detail.
- **The Medium/Low + Partially-Wired tail** (model field hidden, recommendation-linkage display, drift/eval filters, knowledge collection edit, org-wide artifacts list/delete, learning suggestions/lessons/code-signals surfaces, swarm/operations field-hidden items, etc.). *Reason:* out of budget for this pass after the High items + governance surfaces. Each is independently scoped in `SYNC_AUDIT.md` with backend `file:line` and a recommended fix.

### Test gaps to close

- **H2 (workflow execute)** and **H3 (compliance tiles)** were verified against the route contracts + `next build`, but have no dedicated interaction test. *Next step:* a `workflows/[templateId]` page test mocking `next/navigation` + `fetch` to assert `/execute` is called and navigation fires on `action_id`; a `compliance/page` test asserting the renamed evidence keys.
- The four enum/field fixes above are constant/string changes verified by reading the routes; exporting `EVENT_TYPES`/status arrays would allow cheap contract tests.

---

## Files

**New (13):** `app/lib/assumptions-status.js`, `app/lib/apiKeyRoles.js`, `app/capabilities/[capabilityId]/components/CapabilityInvokePanel.jsx`, `app/components/SecurityScanners.jsx`, `app/components/CodeSessionAlertsPanel.jsx`, `app/components/DoctorPanel.jsx`, `app/doctor/page.js`, plus 6 test files (`assumptions-status`, `policy-types-coverage`, `capability-invoke-panel`, `security-scanners`, `code-session-alerts-panel`, `doctor-panel`).

**Modified (19 tracked):** `app/compliance/page.js`, `app/assumptions/page.js`, `app/policies/lib/policyFormModel.js`, `app/policies/components/PolicyRuleBuilderSection.jsx`, `app/policies/components/CustomTab.jsx`, `app/policies/generate/page.jsx`, `app/api/keys/route.js`, `app/api-keys/page.js`, `app/webhooks/page.js`, `app/decisions/page.js`, `app/capabilities/components/CapabilityRegistryFilters.jsx`, `app/capabilities/new/components/CapabilityBasicsSection.jsx`, `app/capabilities/[capabilityId]/page.jsx`, `app/workflows/[templateId]/page.jsx`, `app/security/page.js`, `app/code-sessions/page.js`, `app/components/Sidebar.js`, and 2 test files.

**Migrations:** none. **Protected areas touched:** none.
