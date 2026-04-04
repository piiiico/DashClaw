# DashClaw Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.0] - 2026-04-03

### Added
- **`dashclaw-agent-intel` Python Module**: Local semantic classification for agent tool calls — bash intent detection, file security analysis, 40-tool catalog, session tracking, and MCP health monitoring.
- **Pretool Hook v2**: Governs 40+ tools with enriched intel context, replacing the regex-based 4-tool classification.
- **Posttool Hook v2**: Structured outcome metadata, error classification, and 500-char summaries.
- **`agent_sessions` and `session_events` Database Tables**: New schema for session lifecycle tracking.
- **`permission_level` Column on `agent_pairings`**: Graduated autonomy levels — `readonly`, `workspace_write`, `danger`, `prompt`, `allow`.
- **Session Lifecycle API**: `POST /api/sessions`, `GET /api/sessions`, `PATCH /api/sessions`, `GET /api/sessions/{id}/events`.
- **3 New Guard Policy Types**: `permission_escalation`, `green_contract`, `branch_freshness`.
- **4 New Signal Types**: `session_stalled`, `branch_stale`, `mcp_degraded`, `green_insufficient`.
- **Recovery Recipe Engine**: 6 recipes mapping signals to suggestions and auto-actions.
- **Guard Recovery Field**: Guard response now includes a `recovery` field with suggested remediation.

## [2.3.0] - 2026-03-19

### Added
- **Approval Webhooks**: Webhook subscriptions now support `approval_pending`, `approval_granted`, and `approval_denied` events. Webhooks fire when agents require approval and when admins approve or deny actions, enabling PagerDuty, Opsgenie, and custom bot integrations. Payloads include an `approval_url` for direct approve/deny from external systems.
- **Policy Template Gallery**: New `GET /api/policies/templates` endpoint returns browsable previews of all policy packs (Enterprise Strict, SMB Safe, Startup Growth, Development). The import endpoint now supports `?preview=true` for dry-run mode showing what would be created vs skipped. Policies page includes a "Browse Templates" gallery with one-click install.
- **Cost Dashboard**: New `GET /api/actions/costs` endpoint with by-agent and by-day cost breakdowns. Mission Control gains an "Agent Spend" widget showing total spend, sparkline, and top agents. Cost and token columns added to the decisions list. Decision Replay shows cost and token usage in the result section.
- **Communication Trail in Decision Replay**: Messages between agents are now visible in Decision Replay. New `GET /api/actions/{actionId}/messages` endpoint uses a hybrid strategy — explicit `action_id` tags first, time-window correlation as fallback. Chat-bubble UI shows the conversation that led to a decision.
- **`webhook_deliveries` Table**: Tracks all webhook delivery attempts with status, response, and duration. Previously referenced in code but missing from the schema.
- **Messages API Restored**: `/api/messages`, `/api/messages/threads`, and `/api/messages/attachments` routes moved from archive back to active, fixing SDK `sendMessage()` which was returning 404.

### Changed
- **SDK `sendMessage()`**: Added optional `actionId` parameter that links messages to action records for the communication trail (Node SDK v2.6.0, Python SDK v2.6.0).
- **Webhook Event Types**: `VALID_SIGNAL_TYPES` renamed to `VALID_EVENT_TYPES` to reflect the broader scope of supported events.
- **Policy Pack Previews**: `PACK_PREVIEWS` metadata extracted from the policies page into shared `app/lib/policyPackPreviews.js` module with `inferPolicyType` and `summarizeRules` utilities.

### Tests
- Added 32 new tests: approval webhook wiring (7), policy templates endpoint (9), cost aggregation (8), message trail endpoint (8).

## [2.2.0] - 2026-03-16

### Added
- **CLI Approval Client (`@dashclaw/cli`)**: New terminal package with an interactive approval inbox and `approve`/`deny` commands, enabling terminal-first governance workflows without opening a browser.
- **Structured Approval Block in SDK**: `waitForApproval()` now prints a formatted, boxed approval block on first poll showing action ID, agent, risk score, goal, and replay URL — giving operators all the context needed to act from the terminal.
- **SDK Approval Methods (Node)**: Added `getAction()`, `getPendingApprovals()`, and `approveAction()` to the Node SDK, completing the full CLI approval channel surface.
- **Claude Code Hooks**: New `hooks/dashclaw_pretool.py` and `hooks/dashclaw_posttool.py` Python hooks for Claude Code governance. Pre-tool hook calls the guard before every tool use; post-tool hook records the outcome.
- **Anthropic Claude SDK Governed Demo**: New `examples/anthropic-governed-agent/` showing the four-step governance loop with HITL approval using the Anthropic Claude SDK.
- **OpenAI Agents SDK Governed Demo**: New `examples/openai-agents-governed/` showing governance integration with the OpenAI Agents SDK, including a guard gate and approval wait.
- **CLI Governance Examples**: `examples/claude-code-review-agent/`, `examples/openai-deploy-pipeline/`, and `examples/python-research-agent/` with a shared `examples/README.md` and two-terminal demo instructions.
- **`npx dashclaw-demo`**: New one-command local demo. Starts the runtime in demo mode, runs the governed agent, extracts the replay URL from agent output, and opens the browser to the decision evidence automatically.
- **GitHub Traffic Polling**: `npm run traffic:poll` (`scripts/poll-github-traffic.mjs`) persists GitHub clone and view data to Neon for historical adoption signals beyond the 14-day API window.

### Changed
- **Prompt Injection Scanning Default**: Prompt injection scanning is now on by default for all guard evaluations. Opt out with `DISABLE_PROMPT_INJECTION_SCAN=true`. Aligns with the platform's security-first posture.
- **Platform Skill v2.3**: Updated `dashclaw-platform-intelligence` skill with CLI approval channel and Claude Code hooks workflows. Skill description trimmed for better trigger matching.
- **Demo Replay Correlation**: `openai-governed-agent` example now uses `openai-deployer-1` agent ID and `deploy` action type, matching the demo middleware fixture data so the replay page always loads with full context after `npx dashclaw-demo`.
- **SDK Documentation**: Replaced hardcoded `dashclaw.io` references with env vars. Added CLI Approval Channel and Claude Code Hooks sections. `?legacy=true` toggle for Copy as Markdown / View raw.
- **Connect Prompt**: Uses the four-step governance loop and CLI approval channel pattern in the generated onboarding prompt.
- **Marketing Site**: Added terminal-first agent frameworks (Claude Code, OpenClaw) to the Works With section. New quickstart uses env vars instead of hardcoded keys.

### Fixed
- **Demo Guard Evaluations**: `app/api/guard/route.js` and `middleware.js` now always return a `200 OK` for all guard evaluations (including blocks and approvals). This prevents the SDK from throwing generic errors and properly exposes the `decision` object to agents.
- **SDK `GuardBlockedError` Propagation**: Updated both JS and Python SDKs so that if `_request()` encounters a `403` status due to a policy block, it explicitly raises `GuardBlockedError` instead of a generic `Error`/`DashClawError`.
- **Demo Replay Action States**: Updated the hardcoded `demoTestEval` mock to return `require_approval` instead of `block` so `npx dashclaw-demo` successfully triggers the Human-In-The-Loop terminal wait flow.
- **Demo Replay URL Extraction**: `run-demo.mjs` now parses the replay URL directly from agent stdout using a regex match, ensuring the correct `act_*` ID is opened in the browser every time.
- **Python Examples**: Fixed `first-governed-action.py` to pass a dict to `guard()` instead of kwargs, add missing `agent_id`, remove incorrect `async/await` (Python SDK is sync), and correct `"allowed"` → `"allow"`. Fixed `loop-monitoring.py` to use `register_open_loop`/`resolve_open_loop` instead of non-existent `create_loop`/`update_loop`.
- **CJS Legacy Bridge**: Fixed `sdk/index-v1.cjs` which was importing the wrong file after the v2 SDK refactor.
- **SDK Method Names**: Corrected examples and skill files that referenced removed v1 method names (`registerAssumption` → `recordAssumption`, `createLoop` → `registerOpenLoop`).
- **Dead SDK File**: Deleted diverged `sdk/dashclaw-v2.js` to eliminate confusion between the v2 SDK and the live `sdk/dashclaw.js`.
- **jsdom Vulnerability**: Upgraded `jsdom` 28→29 to resolve three undici CVEs (undici <7.24.0).

### Security
- **Race Condition Fix (Team DELETE)**: `DELETE /api/team/:userId` now uses an atomic CTE query to prevent concurrent requests from removing the last admin.
- **Cross-Tenant Write Fix (createVersion)**: `POST /api/prompts/templates/:templateId/versions` now verifies template ownership before inserting, preventing cross-org writes.
- **ENCRYPTION_KEY Enforcement**: Missing `ENCRYPTION_KEY` in production is now a hard error (was a warning), ensuring encryption is never silently disabled.

### Tests
- **Python SDK v2 Surface Tests**: Added `sdk-python/tests/test_sdk_v2_surface.py` mirroring the Node `sdk-v2.test.js` test suite for cross-language parity verification.
- **HITL Edge Case Coverage**: Expanded `waitForApproval` tests to cover the bypass path (action never entered `pending_approval`), the denial path, and the timeout path.
- **v2 SDK Unit Tests**: Added 41 unit tests covering all 19 public methods of the v2 Node SDK.

## [2.1.5] - 2026-03-15

### Fixed
- **Local Admin Approval Bug**: Fixed an issue in `middleware.js` where the `x-user-id` header was incorrectly set to an empty string instead of the resolved local-admin fallback value (`usr_local_admin`). This prevented the `approved_by` metadata from being correctly recorded in the database when an action was approved locally, causing the strict SDK parity checks to reject the approval as invalid.
- **Unified SDK Versioning**: Bumped both Node.js and Python SDKs to `2.1.5` to stay in sync with the platform and confirm they are tested against the middleware fix.

## [2.1.4] - 2026-03-15

### Fixed
- **SDK `waitForApproval` Bypass Bug**: Fixed a bug where calling `wait_for_approval` on an action that was allowed directly by the guard (never entered `pending_approval`) would crash the SDK instead of acting as a no-op. The strict metadata check is now correctly scoped only to actions that were actually intercepted.

## [2.1.3] - 2026-03-15

### Added
- **HITL Metadata Tracking**: Added `approved_by` and `approved_at` columns to the platform and SDKs to provide a machine-readable source of truth for human approval decisions.
- **SDK v2 Parity (HITL Hardening)**: Synchronized Node.js and Python SDKs with strict approval metadata verification. `waitForApproval` now explicitly requires `approved_by` to be present before resolving.
- **Migration Scripts for HITL**: Added `scripts/migrate-hitl-metadata.mjs` and updated the setup flow to automatically ensure existing databases have the required columns for metadata tracking.

### Changed
- **Mission Control Visual Hierarchy**: Renamed unresolved assumption status to `unresolved_assumption` (labeled "Awaiting Validation") to visually distinguish them from pending approvals.
- **SDK Safety Rails**: Both Node and Python SDKs now throw descriptive errors if an action leaves the `pending_approval` state without explicit approval metadata, preventing "auto-approval" bugs.

## [2.1.1] - 2026-03-15

### Changed
- **SDK Parity Unification**: Synchronized Node.js and Python SDKs to version 2.1.1, ensuring consistent implementation of the 5 core governance methods.
- **Documentation High-Fidelity Sweep**: Comprehensive overhaul of the SDK documentation with richer, production-realistic code examples and a dedicated legacy reference appendix.
- **Next.js 15+ Compatibility**: Updated documentation server components to correctly handle asynchronous search parameters.

## [2.1.0] - 2026-03-14

### Added
- **Governance Boundary CI**: New CI rule (`npm run governance:boundary:check`) that prevents "platform creep" by failing if non-core routes are added to the active API namespace.
- **Minimal Governance Loop Example**: Shipped `examples/dashclaw-example-openai-agent`, a 30-line "Aha! Moment" demo that shows DashClaw blocking a risky action in under 8 minutes.
- **v2 SDK Compatibility Bridge**: New `sdk/index.cjs` providing a clean CommonJS entry point for the minimal v2 runtime.

### Changed
- **Minimal Governance Runtime**: Physically isolated over 140 non-core API routes into the `_archive/` namespace. The active runtime is now hardened to 7 canonical governance primitives.
- **SDK Surface Area Collapse**: Flipped the default `dashclaw` SDK to the v2 runtime. Surface area reduced from 178+ methods to 5 core governance methods (`guard`, `createAction`, `updateOutcome`, `recordAssumption`, `waitForApproval`).
- **Sanitized Mission Control**: Stripped all productivity and analytics bloat from the main dashboard to focus strictly on **Posture, Interventions, Risk Signals, and Fleet Health**.
- **Documentation Overhaul**: Every core document (README, Quickstart, Project Details) has been rewritten to reflect the "Decision Infrastructure" narrative.

### Fixed
- **Friendly Fire Restoration**: Restored essential infrastructure routes (`/api/auth`, `/api/keys`, `/api/usage`) that were accidentally quarantined during the big purge.
- **TypeError in Demo Simulation**: Resolved a crash in the demo middleware where `signals` were incorrectly processed as objects instead of arrays.
- **Ghost Fetch Silence**: Stripped legacy background fetches from the UI that were triggering terminal 404s after the API quarantine.

## [2.5.5] - 2026-03-13

### Changed
- **High-Fidelity Replay Storytelling**: Redesigned Decision Replay visual hierarchy to make the governance signal (ALLOWED, BLOCKED, REQUIRE APPROVAL) the dominant, high-impact focal point.
- **Robust Decision Inference**: Implemented smart fallback logic to correctly identify "Action Prevented" outcomes for high-risk failed actions, even when explicit guard correlation is missing in demo/edge cases.
- **Impactful Simulator Story**: Updated the Simulator Bot to return a compelling "Blocked" narrative (preventing a $12,000 unauthorized charge) to instantly demonstrate product value.
- **Meaningful Outcome Summaries**: Improved description text across all replay views to provide clearer context on why an action succeeded or was intercepted.

### Fixed
- **Confusing Status Labels**: Resolved a bug where high-risk failed actions were incorrectly labeled as "ALLOW" in the replay view.
- **Navigation Breadcrumbs**: Corrected breadcrumb paths for shareable replay and internal detail pages.

## [2.5.0] - 2026-03-13

### Added
- **High-Impact Simulator Story**: Replaced routine success with an emotionally engaging "Blocked" story (intercepted $12,000 charge) to demonstrate governance power instantly.
- **Viral Decision Replays**: Redesigned Public Replay pages to be high-fidelity and screenshot-friendly, condensing the "Intent → Governance → Outcome" narrative into a single viewport.
- **Iframe Embedding Support**: Enabled iframe embedding for decision stories, allowing DashClaw governance evidence to be integrated into external docs, blog posts, and incident reports.
- **Dominant Decision Signal**: Reworked the visual hierarchy of replay pages to make the governance decision (ALLOWED, BLOCKED, REQUIRE APPROVAL) the primary visual focal point.

### Changed
- **Decision Inference Engine**: Implemented robust decision inference logic that correctly identifies "PREVENTED" outcomes for high-risk failed actions even when explicit guard correlation is missing.
- **Outcome Storytelling**: Improved summary text descriptions to provide more meaningful context for both successful and blocked decisions.
- **QuickStart Progression**: Refined the onboarding flow with real-time event listeners that automatically unlock steps as users interact with the SDK.

### Fixed
- **Logic Bug in Replay**: Fixed an issue where high-risk failed actions incorrectly showed as "ALLOW" instead of "BLOCK" in the replay view.
- **SDK Naming**: Corrected the package name to `dashclaw` in all documentation and QuickStart snippets.
- **Security Header Refinement**: Dynamically managed `X-Frame-Options` and `Content-Security-Policy` to support embedding for `/replay/` routes while maintaining system-wide security.

## [2.4.5] - 2026-03-13 (Earlier today)

### Added
- **Dedicated Activity Stream**: New `/activity` page providing a unified, real-time feed of agent intents, guard decisions, and system events.
- **Relocated Decisions Ledger**: Moved actions to `/decisions` to clarify the governance focus.
- **Integrated Audit Log**: Moved workspace activity to `/audit-log` under the Evidence group.

### Changed
- **Setup Page Integration**: Migrated the `/setup` page into the main `PageLayout`, ensuring the sidebar and unified header are always present.
- **High-Fidelity Compliance Reports**: Enhanced the Markdown proof report with realistic framework coverage and enforcement evidence.

### Fixed
- **Decision Detail 404**: Resolved 404 errors by correctly relocating dynamic decision routes to `/decisions/[actionId]`.
- **JSX Syntax Fix**: Corrected malformed nesting in the Decision Replay page that caused 500 build failures.
- **Policy Suite Reliability**: Fixed "Import" button visibility and property mapping in the Policy Test Runner.
- **Tailwind Build Refresh**: Fixed a race condition in the build system where Tailwind failed to track new files after directory moves.

## [2.4.0] - 2026-03-13 (Earlier today)

### Added
- **Agent Governance Transformation**: Pivoted the platform architecture around "Decision Infrastructure," focusing on the causal chain from intent to outcome.
- **Agent Governance Dossier**: New dedicated profile page at `/agents/[agentId]` providing a unified view of an agent's posture, active policies, permissions, and decision history.
- **Status-based Fleet Filtering**: Enhanced the Agent Fleet overview with real-time status filtering (Online, Critical, Offline).
- **Decision Replay Permalinks**: Enabled shareable, public-safe `/replay/[id]` links for decision storytelling and audit reviews.
- **Onboarding QuickStart**: New interactive onboarding component with an integrated "Success Story" simulator to demonstrate governance impact instantly.
- **Policy Lifecycle Parity**: Fully functional Policy CRUD, Simulation, Testing, and Proof Generation enabled in Demo Mode.

### Changed
- **Navigation Realignment**: Standardized the sidebar and header into Command, Governance, Evidence, and System groupings.
- **Unified Page Shell**: Migrated `/setup`, `/replay`, and Agent Profiles to the shared `PageLayout` for consistent navigation and breadcrumbs.
- **Terminology Shift**: Systematically transitioned UI labels from "Actions" to "Decisions" and "Productivity" to "Governance."

### Fixed
- **Audit Log Crash**: Fixed a `TypeError` in demo mode caused by a fixture name mismatch (`activityLogs` vs `activityEvents`).
- **Policy Test UI**: Resolved "undefined fail" and "No policies to test" errors in the Policy Test Runner.
- **Proof Report Format**: Fixed Markdown proof report generation by wrapping the response in a JSON object for client parsing.
- **Demo Middleware Stability**: Standardized fixture mapping across all demo endpoints to prevent data-related crashes.
- **Security Header Consistency**: Applied standard security headers and CORS to all demo responses.

## [2.3.5] - 2026-03-13 (Earlier today)

### Fixed
- **High Severity Vulnerabilities**: Resolved 11 High severity vulnerabilities across `jspdf`, `minimatch`, `xlsx`, and `ajv` via patching and migration to `@e965/xlsx`.
- **Next.js Security**: Upgraded `next` to `^16.1.6` to resolve a medium-severity memory consumption vulnerability.
- **ESLint Migration**: Migrated from deprecated `next lint` to the standard ESLint CLI.
- **React Hook Optimization**: Fixed an unnecessary dependency warning in `DraggableDashboard.js` `useMemo` hook.

## [2.3.4] - 2026-03-11

### Changed
- **Mission Control Continuity**: Added parent/child action-chain expansion in the Decision Timeline so spawned sub-actions can be inspected inline under the decision that created them.
- **Decision Basis Visibility**: Assumptions now appear as first-class governance events in Mission Control, making unresolved or invalidated decision basis visible alongside actions, loops, and guard outcomes.
- **Recent Change Digest**: Added a "What changed in the last 15 minutes" digest that summarizes decision movement, governance pressure, interventions, and landed outcomes.
- **Shared Operator Lens**: Introduced synchronized operator filters across both the Decision Timeline and Mission Feed so operators can focus on decisions, governance, interventions, or outcomes without re-filtering each surface independently.

### Added
- **Mission Control Tests**: Added lightweight unit coverage for `missionControl.js` normalization, telemetry collapse, operator brief summaries, and the recent-change digest.

## [2.3.3] - 2026-03-10

### Changed
- **Mission Control Signal Quality**: Reworked Mission Control around an operator brief, decision-weighted timeline rows, governance/intervention/outcome categorization, and collapsed routine telemetry so meaningful events stand out by default.
- **Timeline Navigation**: Decision Timeline now supports scrolling and keeps category filters available even when the selected category is empty.
- **Active Work Summary**: Expanded the "Currently Running" brief to include governed work that is pending or awaiting approval, which better matches real operator workflow.

### Fixed
- **Prompt Analytics Fallback**: `/api/prompts/stats` no longer returns 500 on installs missing the optional `prompt_runs` table; it now returns a setup hint and degrades cleanly in the UI.
- **Prompt Render Resilience**: Prompt rendering with usage recording enabled no longer fails when `prompt_runs` is unavailable; analytics are skipped while prompt execution still succeeds.

## [2.3.2] - 2026-02-25

### Changed
- **Self-Host Primary CTA**: Updated `/self-host` so `Download Skill` appears first in the top "Get started" action row and is styled as the primary call-to-action.
- **Action Priority**: Demoted `Open Source Repo` to a secondary button style to keep focus on agent-driven setup via the downloadable skill.

## [2.3.1] - 2026-02-25

### Changed
- **Fleet Presence Sizing**: Updated the default dashboard layout to render `Agent Fleet Presence` as a taller 2x4 tile (`w:2, h:4`) for better list visibility and scrolling.
- **Preset Layout Alignment**: Updated `Operations Focus`, `Analytics Focus`, and `Compact Overview` presets to use the same `fleet-presence` 2x4 size and adjusted neighboring tile coordinates to prevent overlap.
- **Layout Versioning**: Incremented dashboard layout state version to `v8` so clients refresh to the new default geometry.

## [2.3.0] - 2026-02-19

### Added
- **Local Admin Password Authentication**: Implemented a local password login mode controlled by the `DASHCLAW_LOCAL_ADMIN_PASSWORD` environment variable, providing a full alternative to OAuth for self-hosted deployments.
- **Local Session Management**: Added a secure, JWT-backed local session system that integrates with the existing middleware and sign-out logic.

## [2.2.2] - 2026-02-19

### Fixed
- **Fleet Presence Merge**: Resolved an issue where agents with heartbeats but no action records were excluded from the dashboard fleet list.
- **Online Detection Fallback**: Improved `isOnline` logic to use `last_active` and `status` as a fallback when `last_heartbeat_at` is missing.
- **Layout Versioning**: Incremented layout state version (v5) to ensure all users receive the updated newspaper-style hierarchy.

## [2.2.1] - 2026-02-19

### Fixed
- **ScoringProfileCard Layout**: Fixed a bug where the card collapsed during loading (rendering null) and failed to fill its grid cell. Now uses `CardSkeleton` and `h-full` for consistent grid alignment.
- **Preset Layout Refinement**: Refined the distribution of newer tiles (Evaluation, Feedback, Drift, Scoring) in the default preset and updated md/sm breakpoints for better density.
- **Layout Versioning**: Incremented layout state version (v4) to trigger a fresh layout load for all users.

## [2.2.0] - 2026-02-19

### Added
- **Dashboard Redesign**: Full layout overhaul of the main dashboard with a new "Newspaper" visual hierarchy across all breakpoints (lg, md, sm).
- **Tile Visibility Toggle**: New "Customize" dashboard modal allowing users to show/hide individual tiles.
- **Persistent Visibility State**: User-level dashboard customization saved to `localStorage`, allowing for a decluttered operational view.
- **Layout Versioning**: Incremented layout state version (v3) to ensure a seamless migration to the redesigned grid for all users.

### Changed
- **Information Hierarchy**: Prioritized fleet status and high-frequency operational cards at the top of the dashboard for better at-a-glance visibility.

## [2.1.0] - 2026-02-19

### Added
- **Link Inspector (Swarm Intelligence)**: New capability to inspect communication bridges between agents in the neural web.
- **Thick, Hoverable Links**: Enhanced swarm visualization with thicker links (3px) and interactive hover/selected states (4px with glow).
- **Link Interaction Logic**: High-performance point-to-line-segment distance detection for O(1) link selection in the canvas rendering loop.
- **Link Context API**: New endpoint `/api/swarm/link` that aggregates shared actions (within 10-minute windows) and direct messages between agent pairs.
- **Link Inspector Side Panel**: Interactive sidebar for selected links featuring "Shared Activity" and "Messages" tabs with real-time sync.

## [2.0.0] - 2026-02-19

### Added
- **Major SDK Expansion**: Added 82 additional methods across 8 new categories to both Node.js and Python SDKs.
- **Unified 2.0.0 Baseline**: Synchronized versioning across the core platform and all official SDKs.
- **Enhanced Category Coverage**: New methods covering advanced agent orchestration, swarm intelligence, and deep observability patterns.

## [1.10.1] - 2026-02-19

### Added
- **Comprehensive Test Suite (Phases 0-7)**: Added 12 new unit test files and expanded the integration test suite to cover Evaluations, Prompts, Feedback, Compliance, Drift, Learning Analytics, and Scoring Profiles.
- **Unit Tests**: Coverage for all 5 scorer types (regex, contains, numeric_range, custom_function, llm_judge), Mustache template rendering, rule-based sentiment/tagging, statistical utilities, maturity model logic, and rule-based multi-dimensional scoring (Phase 7).
- **Integration Tests**: Full API CRUD validation for all feature phases (including Phase 7: Scoring Profiles) added to `scripts/test-full-api.mjs`, ensuring end-to-end reliability.

### Fixed
- **Prompt Rendering**: Fixed a regex bug in `app/lib/prompt.js` where backslashes were not properly escaped in the `RegExp` constructor, causing it to fail on variables with surrounding whitespace (e.g., `{{ name }}`).

## [1.10.0] - 2026-02-19

### Added
- **Scoring Profiles (Phase 7)**: Weighted multi-dimensional quality scoring system for evaluating agent actions without LLM dependencies.
- **Profile Builder**: New interface at `/scoring` for defining scoring profiles with weighted dimensions (speed, cost, risk, reliability, etc.).
- **Scoring Engine**: Rule-based math engine supporting Weighted Average, Minimum, and Geometric Mean composite scoring methods.
- **Auto-Calibration**: Statistical analysis engine that uses percentile-based distribution of historical action data to suggest optimal scoring thresholds.
- **Risk Templates**: Rule-based automatic risk scoring system that replaces hardcoded agent risk numbers with dynamic evaluation.
- **Scoring SDKs**: Added 17 new methods to both Node.js and Python SDKs for profile management, batch scoring, and auto-calibration.
- **Scoring Widget**: New dashboard card showing active profiles, dimension counts, and quick access to score management.
- **Score Explorer**: Real-time breakdown of action quality across all configured dimensions with visual distribution charts.

## [1.9.9] - 2026-02-19

### Added
- **Learning Analytics (Phase 6)**: Agent learning velocity and maturity tracking, providing first-class metrics for agent improvement over time.
- **Velocity Engine**: Statistical computation of learning velocity using linear regression slope and acceleration (second derivative) tracking.
- **Maturity Model**: A 6-level classification system (Novice to Master) based on episode volume, success rate, and average scores.
- **Learning Curves**: Per-agent and per-action-type time-series analysis showing performance evolution across specific skill areas.
- **Analytics Dashboard**: New dedicated interface at `/learning/analytics` with Overview, Velocity, Curves, and Maturity tabs.
- **Analytics SDKs**: Added 6 new methods to both Node.js and Python SDKs for computing velocity, generating curves, and retrieving analytics summaries.
- **Velocity KPI Card**: New dashboard widget showing real-time improvement trends and maturity levels for the agent fleet.
- **Demo Integration**: Rich synthetic fixtures and demo API handlers for learning analytics, velocity, and maturity tracking.

## [1.9.8] - 2026-02-19

### Added
- **Drift Detection (Phase 5)**: Statistical behavioral drift analysis detecting when agent metrics deviate significantly from established baselines using z-score analysis.
- **Automated Baselines**: Dynamic computation of statistical profiles (mean, stddev, percentiles) for risk, confidence, duration, cost, and tokens.
- **Drift Alerts**: Real-time generation of info, warning, and critical alerts when behavioral shifts exceed statistical thresholds (1.5σ, 2.0σ, 3.0σ).
- **Metric Snapshots**: Daily capture of agent metric snapshots for long-term trend visualization and behavioral forensics.
- **Drift Management Dashboard**: New interface at `/drift` with tabs for Alerts, Baselines, and Trends.
- **Drift SDKs**: 9 new Node.js methods and 10 new Python methods for computing baselines, detecting drift, and managing alerts.
- **Drift Widget**: New "Drift" dashboard card providing an at-a-glance view of critical/warning alerts and agent-specific drift status.

## [1.9.7] - 2026-02-19

### Added
- **Compliance Export (Phase 4)**: Bundled audit-ready report generation across multiple frameworks (SOC 2, ISO 27001, NIST AI RMF, EU AI Act, GDPR).
- **Scheduled Exports**: Cron-based recurring export generation (weekly, monthly, quarterly) with email-ready markdown or JSON payloads.
- **Evidence Packaging**: Automatic attachment of guard decision logs and action record history to compliance reports for a complete audit trail.
- **Remediation Priority Matrix**: Intelligent sorting of compliance gaps by priority, agent relevance, and estimated effort.
- **Coverage Trend Tracking**: Visualized history of compliance posture over time with improvement/decline detection.
- **Export SDKs**: Added 11 new methods to both Node.js and Python SDKs for managing exports, schedules, and trends.
- **Export Management Dashboard**: New interface at `/compliance/exports` for on-demand generation, scheduling, inline report viewing, and downloads.

## [1.9.6] - 2026-02-19

### Added
- **User Feedback Loop (Phase 3)**: Structured feedback system for measuring human satisfaction with agent actions.
- **Feedback Management Dashboard**: New interface at `/feedback` for tracking user ratings, comments, and triage status.
- **Rule-based Sentiment & Tagging**: Automated sentiment detection (Positive/Negative/Neutral) and categorical tagging (performance, accuracy, UX, etc.) without LLM overhead.
- **Feedback Analytics**: Real-time distribution charts, sentiment trends, and agent-specific quality breakdowns.
- **Feedback SDKs**: Added `submitFeedback()`, `listFeedback()`, and `getFeedbackStats()` to both Node.js and Python SDKs.
- **Dashboard Feedback Widget**: Draggable card for the main dashboard showing aggregated sentiment bars and top agent ratings.

## [1.9.5] - 2026-02-19

### Added
- **Evaluation Framework (Phase 1A & 1B)**: A complete system for measuring and scoring agent decision quality.
- **Evaluations Dashboard**: New full-page interface for managing evaluation scores, scorers, and batch runs.
- **Scoring Engine**: Support for Regex, Keyword, Numeric Range, Custom Expression, and LLM-as-judge (AI) scorers.
- **Evaluations Widget**: Draggable dashboard widget with score distribution charts and average quality metrics.
- **Evaluation SDKs**: Added `evaluate()`, `createScorer()`, and `runEval()` to both Node.js and Python SDKs.
- **Batch Eval Runs**: Capability to run batch evaluations against historical agent actions.
- **Demo Integration**: Comprehensive evaluation fixtures and demo routes for testing the framework without a live backend.

## [1.9.4] - 2026-02-19

### Added
- **Swarm Pulse (Distribute/Expand)**: New "Expand Swarm" button in the Swarm Intelligence dashboard. Trigger a physical pulse that temporarily spreads agents apart, improving visibility into complex neural webs.
- **High-Performance Swarm Rendering**: Completely refactored the `/swarm` canvas rendering loop to support 50+ agents with minimal CPU/GPU overhead. 
- **Optimized Physics Sync**: Decoupled visual state (packets/particles) from the React state tree, eliminating re-render thrashing and ensuring smooth 60fps performance on high-density agent fleets.
- **Zero-Latency Panning & Dragging**: Restored manual agent rearrangement and viewport panning with optimized coordinate mapping and O(1) node lookups.

## [1.9.3] - 2026-02-18

### Added
- **Visual Action Tracing**: Interactive, node-based decision trees in the Action Post-Mortem view. Visualize parent chains, sub-actions (spawned decisions), assumptions, and open loops in a unified branching graph.
- **Policy Simulation (Dry Run)**: Test proposed guard policies against historical agent activity. See exactly what would have been blocked, warned, or gated over the last 1-30 days before enabling a rule.
- **Agent Heartbeat & Presence**: Real-time fleet monitoring. Agents can now report status ("online", "busy", "error") and active task IDs via the new SDK `heartbeat()` method.
- **Fleet Presence Dashboard**: New "Agent Fleet Presence" card on the main dashboard showing real-time uptime and activity status for the entire agent fleet.
- **Lost Heartbeat Signal**: New automated risk signal (`agent_silent`) that fires when an agent with an active task hasn't reported in for over 10 minutes.
- **SDK v1.9.3**: Added `heartbeat()`, `startHeartbeat()`, and `stopHeartbeat()` to both Node and Python SDKs.

## [1.9.2] - 2026-02-18

### Added
- **Redis Real-time Backend**: Support for Upstash Redis as an event broker to enable live dashboard updates on serverless hosts like Vercel.
- **Self-Host Guide Updates**: Explicit instructions for Redis-backed live events in the cloud deployment path.

## [1.9.1] - 2026-02-17

### Added
- **Full Dashboard Real-Time Streaming**: Extended SSE events to include `DECISION_CREATED`, `GUARD_DECISION_CREATED`, `SIGNAL_DETECTED`, and `TOKEN_USAGE`.
- **Reactive UI Components**: Updated Decision Timeline, Recent Actions, Risk Signals, Learning Stats, and Token Budget cards to update instantly via `useRealtime`.
- **Mission Control Split-View**: Redesigned Mission Control bottom section with a side-by-side view of the Decision Timeline and a new **Live Swarm Log** (real-time terminal-style feed).
- **Backend Event Integration**: Integrated `publishOrgEvent` into guard evaluation, learning records, and token usage snapshots.
- **SDK v1.9.1**: Bumped all SDK versions to match platform capabilities.

### Fixed
- **Timeline Payload Bug**: Fixed a bug in `ActivityTimeline` where real-time event payloads were not being parsed correctly.
- **Polling Reduction**: Removed legacy `setInterval` polling from Learning and Token cards in favor of lightweight SSE pushes.

## [1.8.1] - 2026-02-15

### Added
- **Real-Time SSE Events**: New `POLICY_UPDATED`, `TASK_ASSIGNED`, `TASK_COMPLETED` event types emitted from policy CRUD and task routing routes.
- **SDK `events()` method**: SSE client for agents to subscribe to real-time events (Node SDK only, zero dependencies).
- **SSE-based `waitForApproval()`**: New `useEvents: true` option for instant approval resolution instead of polling.
- **Client-side SSE listeners**: `useRealtime` hook now handles `policy.updated`, `task.assigned`, `task.completed` events.
- **Digest repository**: Extracted digest queries from route into `digest.repository.js`.

## [1.8.0] - 2026-02-15

### Security
- **Deep Security Audit**: Comprehensive 5-agent parallel audit across auth, input validation, secrets, network surface, and AI governance risks. Resolved 4 CRITICAL, 9 HIGH, and 8 MEDIUM severity findings.
- **SSRF Protection for Task Routing**: `dispatchToAgent()` and `fireCallback()` now validate URLs with DNS resolution, private IP blocking, HTTPS enforcement, and redirect prevention — matching the existing webhook SSRF protections.
- **Agent Signature Enforcement**: Signatures are now enforced by default in production (`ENFORCE_AGENT_SIGNATURES`). Opt out explicitly with `=false`.
- **Closed Agent Enrollment**: New `DASHCLAW_CLOSED_ENROLLMENT=true` mode requires agents to be pre-registered before submitting actions.
- **Timing-Safe Secret Comparison**: All 5 cron routes now use a shared `timingSafeCompare` utility. Middleware timing-safe function improved to prevent length leaks.
- **Cron Auth Fix**: `/api/cron/routing-maintenance` was missing `CRON_SECRET` validation while being publicly routable — now secured consistently with all other cron endpoints.
- **Rate Limit Bypass Fix**: `x-real-ip` header is no longer trusted unless `TRUST_PROXY=true`, preventing attackers from spoofing IPs to bypass rate limits.
- **Request Body Size Limit**: 2 MB maximum enforced in middleware for all POST/PUT/PATCH requests.
- **SDK HTTPS Warnings**: Both Node and Python SDKs now warn when `baseUrl` does not use HTTPS, preventing plaintext API key transmission.
- **Markdown XSS Prevention**: Agent messages rendered via `ReactMarkdown` now block `javascript:` and other unsafe URL schemes in links.
- **Demo Cookie Bypass Fix**: The `dashclaw_demo` cookie no longer activates demo mode on self-hosted deployments — only honored when `DASHCLAW_MODE=demo`.
- **Invite URL Hardening**: Invite link generation now uses `NEXTAUTH_URL` as the canonical origin instead of trusting `x-forwarded-host`.
- **Input Validation Hardening**: Agent-reported `risk_score` clamped to 0-100, cost/token values bounded to safe maximums, routing agent registration validates endpoint URLs and input ranges.
- **Leaked Key Cleanup**: Removed accidental API key from `.next/standalone/.env` build artifact. Added `.dockerignore` to prevent future leaks.

### Added
- **Startup Environment Validation**: New `validateEnv.js` module warns on missing configuration and errors on critical production misconfigurations (OAuth, API key, encryption key).
- **Guard Fallback Control**: New `DASHCLAW_GUARD_FALLBACK` env var to globally configure semantic guard behavior when LLM is unavailable (`allow` or `block`).
- **SSE Connection Limits**: Server-side 30-minute max duration for SSE streams with bounded deduplication set (10,000 entries max).

### Changed
- **OAuth Provider Registration**: Providers are now conditionally registered based on available credentials. Production deployments without any OAuth configuration log an error at startup instead of silently using mock values.
- **HSTS Header**: Upgraded to `max-age=63072000; includeSubDomains; preload` (2-year max-age with preload).
- **Source Maps**: Explicitly disabled browser source maps in production builds.
- **Sync Validation**: All Zod array validators in the bulk sync schema now enforce `.max()` bounds matching the runtime `LIMITS` constants, rejecting oversized payloads at parse time.

## [1.7.0] - 2026-02-14

### Added
- **One-click Agent Pairing**: New pairing flow for verified agents (agents request enrollment, admins approve via a click link or `/pairings` inbox).
- **Pairing APIs**: `/api/pairings` endpoints to create, list, fetch, and approve pairing requests.
- **Pairings UI**: `/pair/:pairingId` approval page and `/pairings` inbox (includes Approve All for 50+ agents).

### Changed
- **Canonical Signing**: Agent action signatures now use canonical JSON (stable key ordering / no whitespace) to prevent flaky signature failures.
- **Signature Enforcement Control**: Signature enforcement is now controlled via `ENFORCE_AGENT_SIGNATURES=true` (instead of implicitly depending on `NODE_ENV`).

## [1.6.2] - 2026-02-14

### Added
- **Adaptive Learning Loop MVP**: Added episode scoring and recommendation synthesis for agent performance improvement over time.
- **Learning Recommendations API**: New endpoint `/api/learning/recommendations` with role-gated rebuild support (`POST`) and recommendation retrieval (`GET`).
- **Learning Loop Cron Jobs**: Added scheduled endpoints for automated learning maintenance:
  - `/api/cron/learning-episodes-backfill`
  - `/api/cron/learning-recommendations`
- **SDK Recommendation Methods**:
  - Node SDK: `getRecommendations()`, `rebuildRecommendations()`, `recommendAction()`
  - Python SDK: `get_recommendations()`, `rebuild_recommendations()`, `recommend_action()`

### Changed
- **Action Outcome Pipeline**: `PATCH /api/actions/[actionId]` now best-effort scores learning episodes for adaptive recommendation generation.
- **Operational Scripts**: Added learning-loop migration/backfill/rebuild scripts and npm commands for repeatable operations.

## [1.5.0] - 2026-02-13

### Added
- **Human-in-the-Loop (HITL) Governance**: New "Approval Queue" dashboard at `/approvals` for real-time human intervention in agent workflows.
- **Pending Approval State**: Actions triggered by `require_approval` policies now pause in a dedicated state until an administrator approves or denies them.
- **SDK Blocking & Polling**: Node.js and Python SDKs now support `hitlMode: 'wait'`, allowing agents to automatically pause and wait for human decisions.
- **Approval API**: New endpoint `POST /api/actions/[actionId]/approve` for centralized decision management.

## [1.4.0] - 2026-02-13

### Added
- **Swarm Intelligence**: New visual dashboard at `/swarm` for decision visibility across multi-agent communication maps and operational risk.
- **Swarm Graph API**: New endpoint `/api/swarm/graph` providing node-link data for large agent swarms (up to 50+ agents).
- **Communication Topology**: Visual mapping of agent-to-agent message flow with risk-based node highlighting.

## [1.3.2] - 2026-02-13

### Added
- **Proactive Memory Maintenance**: New server-side cron job that identifies stale assumptions and conflicting decisions.
- **Memory Correction Messages**: System-to-agent messaging that suggests specific memory pruning and verification tasks.

## [1.3.1] - 2026-02-13

### Added
- **CrewAI Integration**: New adapter for CrewAI agents and tasks to track multi-agent research.
- **AutoGen Integration**: Hook-based integration for AutoGen to monitor conversational agent turns.
- **Node SDK v1.3.1**: Synced version with platform.
- **Python SDK v1.3.1**: New integrations and RSA signing support.

## [1.3.0] - 2026-02-13

### Added
- **Data Loss Prevention (DLP)**: Automated regex-based redaction for sensitive keys (OpenAI, AWS, GitHub, etc.) in agent messages and handoffs.
- **Strict Sync Validation**: Implemented Zod-based schema validation for the Bulk Sync API to prevent malformed data injection.
- **Agent Identity Enforcement**: Made agent signatures mandatory in production for all Action Record creations.

### Security
- **Auth Hardening**: Refactored middleware to "fail closed" in production if security keys are missing.
- **HSTS Enforcement**: Added `Strict-Transport-Security` headers to all API routes.
- **Audit Log Redaction**: Added local redaction engine to the Python Audit Logger to prevent secret leakage in local SQLite databases.
- **Dependency Patching**: Upgraded Next.js to stable v15.1.12 and esbuild to v0.25.0 to resolve known vulnerabilities while maintaining CI stability.
- **Standardized DB Layer**: Centralized all database connection logic into a shared utility with strict production safety checks.

## [1.2.4] - 2026-02-13

### Added
- **Security Health UI**: Added a real-time "Security Score" and system health checklist to the Security dashboard.
- **Security Tests**: Added unit tests for SSRF protection and webhook validation.

### Changed
- **Environment Template**: Updated `.env.example` with `ENCRYPTION_KEY` and `WEBHOOK_ALLOWED_DOMAINS`.

## [1.2.3] - 2026-02-13

### Added
- **Security Dashboard API**: New endpoint `/api/security/status` for verifying encryption health and system security score.

### Security
- **Comprehensive Audit**: Full IDOR (Insecure Direct Object Reference) audit of all resource endpoints to ensure strict multi-tenant isolation.
- **Plan Escalation Fix**: Restricted organization creation to the 'free' plan by default, ignoring unauthorized user-provided plan overrides.
- **Auto-Encryption**: Added server-side enforcement for sensitive keys (API_KEY, DATABASE_URL, etc.) to ensure they are always encrypted before storage.
- **Hardened Error Handling**: Standardized generic error responses across the API to prevent information leakage.

## [1.2.2] - 2026-02-13

### Fixed
- **Build Failure**: Resolved "Invalid project directory" error in CI by adjusting Next.js version to a stable security-patched release (15.5.10).

## [1.2.1] - 2026-02-13

### Security
- **SSRF Hardening**: Enhanced webhook URL validation with stricter blocked patterns and optional domain allowlist support.
- **Dependency Updates**: Resolved vulnerabilities in `next` and `esbuild` through security patches.
- **Scanner Integrity**: Updated internal security scanner to ensure comprehensive directory coverage.
- **Cleanup**: Removed unverified third-party agent skills and scripts from the repository.

## [1.2.0] - 2026-02-12

### Added
- **Self-Hosting Support**: Added production-optimized `Dockerfile` and `docker-compose.yml`.
- **Operational Maturity**: Added `CONTRIBUTING.md` for community participation.
- Enabled `standalone` output in Next.js configuration for leaner container images.

## [1.1.0] - 2026-02-12

### Added
- **Identity Binding**: Cryptographic agent verification using RSA-PSS signatures (Sign-on-Source, Verify-on-Sink).
- New admin endpoint `/api/identities` for agent public key management.
- Verified "Trust Badge" (green shield) in the dashboard UI for cryptographically signed actions.
- `scripts/generate-agent-keys.mjs` helper for agent keypair generation.
- `scripts/migrate-identity-binding.mjs` for database schema updates.

### Changed
- Updated DashClaw SDK to support automatic payload signing with JWK or CryptoKey.

## [1.0.0] - 2026-02-12

### Added
- Initial public release of DashClaw.
- AI Agent Dashboard built with Next.js 14 (App Router).
- Suite of Python CLI tools for agent memory, context, and goal tracking.
- ActionRecord control plane for full action lifecycle tracking.
- Behavior Guard system with policy evaluation (risk, approval, rate-limiting).
- Multi-tenant organization support with API key authentication.
- Real-time decision integrity signals and security enforcement.
- Agent-to-agent messaging hub and collaborative shared docs.

### Security
- SHA-256 API key hashing for secure organization access.
- AES-256 encryption for integration credentials and sensitive settings.
- Native Content Security Policy (CSP) and security headers configuration.
