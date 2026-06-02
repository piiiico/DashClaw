# DashClaw Sync Audit — Implementation Pass — 2026-06-02

Implements fixes from `SYNC_AUDIT.md`. Audit-only items became real, tested changes. Scope was protected: **no** OAuth connector, MCP, auth, middleware, or billing files were touched. No schema changes were needed, so **no migration** was generated.

## Verification (run before writing this report)

- `npm run lint` → **clean** (0 errors).
- `npx vitest run` (full suite) → **2492 passed, 5 skipped, 0 failed** (309 files) after the 2026-06-02 continuation (2479 in the first pass).
- `npx next build` → **succeeded**; route manifest emitted `/secrets`, `/doctor`, and the renamed `/compliance` pages.
- `git diff` reviewed → only audit-scoped files changed; secret-pattern scan of the diff returned nothing.

**41 new/updated test cases** were added across 10 files asserting real fields, statuses, outputs, permissions, and error paths (not mock-echo) — including a UI↔backend contract test that compiles every policy type and runs it through the real `validatePolicy`, the Run→`/execute`→navigate flow, and the corrected compliance evidence keys. (28 in the first pass; +13 in the 2026-06-02 continuation.)

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
| H12 | **Secret rotation had no UI** | New `app/secrets/page.jsx` — list (org-wide or by agent scope), track (name/agent/interval/notes → `POST /api/secrets`), per-row "Mark rotated" (`PATCH last_rotated_at`) and delete, plus an org-wide rotation-due banner from `/api/secrets/rotation-due`. Stores rotation metadata only — never secret values. Added `/secrets` to the Configure nav. Admin-gated via the real `useEffectiveRole`. | `secrets-page.test.jsx` (6: list, mark-rotated PATCH body, delete, create POST body, due banner, member read-only) |
| H13 | **Skill safety scanner had no UI** | New `app/components/SkillScanner.jsx` mounted on `/security` — multi-file (filename + content) → `POST /api/skills/scan`, renders pass/fail, per-finding severity + `file:line` + rule + masked match, and a cached badge. | `skill-scanner.test.jsx` (4: clean pass, high-severity fail, multi-file request body, client-side guard) |

### Medium / enum

| Finding | Implementation |
|---------|----------------|
| Webhook dropdown omitted approval events | `app/webhooks/page.js` `EVENT_TYPES` now includes `approval_pending`/`approval_granted`/`approval_denied` (matches `VALID_EVENT_TYPES`). |
| Decisions ledger lacked `pending_approval` filter | `app/decisions/page.js` status options include `pending_approval` (humanized labels). |
| Capability registry health filter omitted `failing`/`untested` | `CapabilityRegistryFilters.jsx` now lists all `deriveStatus()` values. |
| Capability edit `health_status` dropdown omitted runtime values | `CapabilityBasicsSection.jsx` adds `untested`/`failing`. |

---

## Continuation pass (2026-06-02) — what closed

The two remaining High governance surfaces and both flagged test gaps are now done:

- **H12 Secrets rotation UI** and **H13 Skill safety scanner UI** — shipped (see the High table above). No schema change.
- **H2 / H3 test gaps closed.** `workflow-detail.page.test.jsx` now asserts the Run button POSTs `/execute` and `router.push`-es to `/workflows/{id}/runs/{action_id}` on success, and surfaces a policy block inline without navigating. `compliance-page.test.jsx` renders the page and asserts the evidence tiles read the corrected keys (`guard_decisions_total` / `guard_decisions_blocked` / `action_records_total`). To make the latter testable, `app/compliance/page.js` was renamed to `page.jsx` (the repo convention for unit-tested pages — Vite's `.js` loader doesn't parse JSX); no behavior change, no import references the old path.

## Not fixed (precise next steps)

These remain from `SYNC_AUDIT.md`. Each route exists and was confirmed; only the UI is missing.

- **The Medium/Low + Partially-Wired tail** (model field hidden, recommendation-linkage display, drift/eval filters, knowledge collection edit, org-wide artifacts list/delete, learning suggestions/lessons/code-signals surfaces, swarm/operations field-hidden items, etc.). *Reason:* out of scope for the High + governance-surface passes. Each is independently scoped in `SYNC_AUDIT.md` with backend `file:line` and a recommended fix.

### Test gaps remaining

- The four enum/field fixes above are constant/string changes verified by reading the routes; exporting `EVENT_TYPES`/status arrays would allow cheap contract tests.

---

## Files

**New (13):** `app/lib/assumptions-status.js`, `app/lib/apiKeyRoles.js`, `app/capabilities/[capabilityId]/components/CapabilityInvokePanel.jsx`, `app/components/SecurityScanners.jsx`, `app/components/CodeSessionAlertsPanel.jsx`, `app/components/DoctorPanel.jsx`, `app/doctor/page.js`, plus 6 test files (`assumptions-status`, `policy-types-coverage`, `capability-invoke-panel`, `security-scanners`, `code-session-alerts-panel`, `doctor-panel`).

**Modified (19 tracked):** `app/compliance/page.js`, `app/assumptions/page.js`, `app/policies/lib/policyFormModel.js`, `app/policies/components/PolicyRuleBuilderSection.jsx`, `app/policies/components/CustomTab.jsx`, `app/policies/generate/page.jsx`, `app/api/keys/route.js`, `app/api-keys/page.js`, `app/webhooks/page.js`, `app/decisions/page.js`, `app/capabilities/components/CapabilityRegistryFilters.jsx`, `app/capabilities/new/components/CapabilityBasicsSection.jsx`, `app/capabilities/[capabilityId]/page.jsx`, `app/workflows/[templateId]/page.jsx`, `app/security/page.js`, `app/code-sessions/page.js`, `app/components/Sidebar.js`, and 2 test files.

### Continuation pass (2026-06-02) files

**New (5):** `app/secrets/page.jsx`, `app/components/SkillScanner.jsx`, and 3 test files (`secrets-page`, `skill-scanner`, `compliance-page`).

**Renamed (1):** `app/compliance/page.js` → `app/compliance/page.jsx` (no behavior change; enables the H3 render test).

**Modified (3):** `app/components/Sidebar.js` (+`/secrets`), `app/security/page.js` (mount `SkillScanner`), `__tests__/unit/workflow-detail.page.test.jsx` (+2 H2 cases). Docs: `PROJECT_DETAILS.md` (+`/secrets` surface).

**Migrations:** none. **Protected areas touched:** none.
