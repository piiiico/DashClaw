# Agent Toolkit Into Runtime — Design

**Date:** 2026-05-14
**Status:** Approved (verbal), pending written review
**Decision context:** The `agent-tools/` Python CLI bundle (29 tools, ~10k LOC) has no users — neither the owner nor any of the governed agents (Claude Code / Codex / Hermes) know it exists. The companion `sync_to_dashclaw.py` script has fragile schema-translation bugs (`no such column: created_at` in the live `learning.db` schema). The whole bundle is a parallel ecosystem to DashClaw, duplicating ~12 features the runtime already has, and bridging them across a broken pipe.

## Goal

Replace the standalone Python toolkit with first-class DashClaw features that governed agents discover and invoke automatically via the existing MCP server. Agents take care of continuity, security hygiene, and reflection without a human running `python <tool>.py <command>`.

## Non-goals

- **Not** rebuilding everything in `agent-tools/`. 16 tools are dropped entirely (relationship-tracker, goal-tracker, project-monitor, api-monitor, backup-verify, health-check, memory-search, memory-extractor, memory-health, automation-library, data-classifier, token-capture, token-tracker, cost-estimator, token-efficiency, token-optimizer).
- **Not** preserving the Python CLI surface. The toolkit's value moves into the runtime; the CLIs disappear.
- **Not** writing a sync bridge. There's nothing to sync — data is born inside the runtime.

## Scope

Six features land in DashClaw, distributed via the existing Claude Code / Codex / Hermes plugin bundles. Three are new (schema + routes + MCP); three are MCP wrappers over already-existing routes.

### New features

#### 1. Session handoffs

Carries context between agent sessions so the next session picks up where the last one left off.

**Schema** — `code_session_handoffs`:

```
id                          text  PK   ("hf_*" id format)
org_id                      text  FK orgs
agent_id                    text  NOT NULL
project_id                  text  FK code_projects, nullable
created_in_session_id       text  nullable (provenance only)
bundle_json                 jsonb NOT NULL
created_at                  timestamptz default NOW()
consumed_at                 timestamptz nullable
consumed_by_session_id      text  nullable
```

Lookup key: `(org_id, agent_id, project_id)` — most recent `created_at` wins. Falls back to agent-scoped when `project_id` is null.

**`bundle_json` contract:**
```ts
{
  summary: string,              // 1-2 sentence wrap-up of last session
  open_loops: Array<{ id: string, description: string, due?: string }>,
  decisions_made: Array<{ id: string, description: string }>,
  state_snapshot?: object,      // freeform JSON the agent wants to remember
  generated_at: string          // ISO timestamp
}
```

**Routes:**
- `POST /api/handoffs` — body: `{ agent_id, project_id?, bundle }`; returns `{ id }`
- `GET /api/handoffs/latest?agent_id=…&project_id=…` — returns latest unconsumed handoff or 404
- `GET /api/handoffs/:id` — returns specific handoff
- `POST /api/handoffs/:id/consume` — body: `{ session_id? }`; sets `consumed_at`

**MCP tools:**
- `dashclaw_handoff_create({ agent_id, project_id?, bundle })`
- `dashclaw_handoff_latest({ agent_id, project_id? })` — agents use this on session start
- `dashclaw_handoff_consume({ id, session_id? })`

**Hermes wiring:**
- `on_session_end` hook calls `dashclaw_handoff_create` with a generated bundle
- `on_session_start` hook calls `dashclaw_handoff_latest`; if found, injects the bundle's summary + open-loops into the pre-LLM context via the existing `pre_llm_call` injection contract, then immediately calls `dashclaw_handoff_consume` to mark it claimed

**Claude Code / Codex wiring:** Hermes is the only one of the three with a native `on_session_start` event, so:

- **Hermes:** native `on_session_end` → `_handoff_create`; `on_session_start` → `_handoff_latest` + `_handoff_consume`. Fully automatic.
- **Claude Code:** native `Stop` hook → `_handoff_create`. Reading the handoff at the start of a new session relies on the governance skill instructing the agent to call `dashclaw_handoff_latest` on its first turn (instructions live in the existing CLAUDE.md governance protocol the install script drops into projects).
- **Codex:** identical pattern to Claude Code — `Stop` hook for create; AGENTS.md instructs `_handoff_latest` on first turn.

Hermes gets the fully-automatic flow; Claude Code / Codex get a skill-mediated equivalent. Both meet the bar that humans never call these MCP tools by hand.

---

#### 2. Secret rotation tracker

Stores **metadata only** (no secret values). Reminds agents which credentials are due for rotation.

**Schema** — `governed_secrets`:

```
id                       text  PK ("sec_*" id format)
org_id                   text  FK orgs
agent_id                 text  nullable (org-wide if null)
name                     text  NOT NULL ("stripe-prod-key")
last_rotated_at          timestamptz default NOW()
rotation_interval_days   int   default 90
notes                    text  nullable
created_at               timestamptz default NOW()
updated_at               timestamptz default NOW()

unique(org_id, agent_id, name)
```

`next_rotation_due` is computed on read (`last_rotated_at + interval`).

**Routes:**
- `GET /api/secrets?agent_id=…` — list tracked secrets for an agent / org
- `POST /api/secrets` — body: `{ agent_id?, name, last_rotated_at?, rotation_interval_days?, notes? }`
- `PATCH /api/secrets/:id` — body: any of `{ last_rotated_at, rotation_interval_days, notes }`
- `DELETE /api/secrets/:id`
- `GET /api/secrets/rotation-due?within_days=…&agent_id=…` — secrets due within window

**MCP tools:**
- `dashclaw_secret_list({ agent_id? })`
- `dashclaw_secret_due({ within_days?, agent_id? })` — agents call this proactively
- `dashclaw_secret_mark_rotated({ id })`

---

#### 3. Skill safety scanner

Static safety scan for skill content. Detects network exfil patterns, `exec`/`eval` calls, embedded secrets, suspicious imports. Findings are stored so a re-scan of unchanged content returns the cached result.

**Schema** — `skill_scan_results`:

```
id                       text  PK ("scn_*" id format)
org_id                   text  FK orgs
skill_name               text  NOT NULL
target_hash              text  NOT NULL  (sha256 of scanned content; dedupe key)
findings                 jsonb NOT NULL  (Array<Finding>)
passed                   boolean NOT NULL
created_at               timestamptz default NOW()

unique(org_id, skill_name, target_hash)
```

`Finding` shape:
```ts
{
  severity: 'high' | 'medium' | 'low',
  rule_id: string,             // "py/exec-call", "secrets/anthropic-key", etc.
  pattern: string,
  file: string,
  line: number,
  match: string
}
```

`passed = true` iff no `severity: 'high'` findings.

**Routes:**
- `POST /api/skills/scan` — body: `{ skill_name, content? | path? }`; returns scan result (cached if `target_hash` exists)
- `GET /api/skills/scans/:id`

**MCP tool:**
- `dashclaw_skill_scan({ skill_name, content })` — returns `{ passed, findings, scan_id }`

Detection rules ported from `agent-tools/tools/security/skill_checker.py`'s existing patterns. Output JSON-shaped instead of stdout.

---

### MCP wrappers over existing routes

#### 4. Open loops

`open_loops` table already exists. Adds API ergonomics + MCP exposure.

**Routes to add (if missing — verify during execution):**
- `GET /api/loops?agent_id=…&status=open|closed`
- `POST /api/loops` — body: `{ agent_id, description, due_at? }`
- `PATCH /api/loops/:id` — body: `{ status?, description?, due_at? }`
- `DELETE /api/loops/:id`

**MCP tools:**
- `dashclaw_loop_add({ agent_id, description, due_at? })`
- `dashclaw_loop_list({ agent_id, status? })`
- `dashclaw_loop_close({ id })`

---

#### 5. Learning database

`learning_*` tables + `/api/learning/*` routes already exist. Adds MCP exposure.

**MCP tools:**
- `dashclaw_learning_log({ agent_id, decision, context, outcome? })` — wraps existing `/api/learning/log`
- `dashclaw_learning_query({ agent_id, query?, limit? })` — wraps `/api/learning/lessons`
- `dashclaw_learning_recommendations({ agent_id, action_type? })` — wraps `/api/learning/recommendations`

---

#### 6. Recent decisions / audit log

`/api/decisions` already exists. Adds one MCP tool for in-session retrospection.

**MCP tool:**
- `dashclaw_decisions_recent({ agent_id?, action_type?, decision?, since?, limit? })` — single unified filter over the decisions ledger; returns decision records with both the recorded action and the guard verdict

---

## Distribution

All 12 new MCP tools land in `mcp-server/lib/tools.js`. The Claude Code / Codex / Hermes plugins (`plugins/dashclaw/.{claude,codex,hermes}-plugin/`) already point at this MCP server via `.mcp*.json` — plugin manifests do not change.

The `dashclaw-governance` skill (hand-authored at `public/downloads/dashclaw-governance/SKILL.md`) gains six new "when to use" sections, one per feature:

```
## After concluding a session
Call dashclaw_handoff_create with a bundle containing your summary, any
open loops, and decisions you made. The next session of yours will pick
this up automatically via dashclaw_handoff_latest in pre_llm_call.

## Before loading an unknown skill
Call dashclaw_skill_scan with the skill's content. If passed=false, don't
load the skill — show the findings to the operator instead.

## Before acting on credentials
Call dashclaw_secret_due to surface any credentials overdue for rotation.
If an action uses an overdue credential, flag it to the operator (via the
record action) rather than proceeding silently. Registering new credentials
for tracking is an operator task — agents don't add secrets themselves
(that would be an authorization-creep risk).

[... and three more for loops, learning, decisions ...]
```

The `dashclaw-platform-intelligence` skill is livingcode-generated; the new MCP tools appear in its `api-surface.md` references on the next `npm run livingcode:refresh` automatically.

After livingcode refresh, the mirror writes the updated skills to:
- `public/downloads/dashclaw-{governance,platform-intelligence}/` (canonical)
- `plugins/dashclaw/skills/dashclaw-platform-intelligence/` (committed plugin distribution — per the drift fix in commit c8b3fb07)
- `~/.claude/skills/` (global)
- `.claude/skills/` (project-local)

## Retirement

In the same change set:

- `rm -rf agent-tools/` — deletes 29 Python tools, install scripts, sync script
- `rm app/toolkit/page.js` — replaced with a Next.js redirect (`redirects()` in `next.config.js`) to `/docs#mcp-tools`. Preserves inbound links and search-engine paths.
- Remove `/toolkit` link from `app/components/PublicNavbar.js`, `app/components/PublicFooter.js`
- Update CLAUDE.md, PROJECT_DETAILS.md, README.md references to the Python toolkit
- Update `app/landingData.js` features array if it references toolkit features (audit during execution)

The retirement happens **last** in the change order so the new MCP tools are live before the CLIs disappear.

## Data flow — session handoff end-to-end

```
Hermes session N ends
  └─> .hermes/hooks/dashclaw_on_session_end_hermes.py
       ├─> Generates bundle: summary + open_loops + recent decisions
       └─> MCP: dashclaw_handoff_create({ agent_id: "hermes", project_id, bundle })
            └─> POST /api/handoffs
                 └─> code_session_handoffs INSERT, returns hf_*

Hermes session N+1 starts (same agent_id, same project)
  └─> .hermes/hooks/dashclaw_on_session_start_hermes.py
       ├─> MCP: dashclaw_handoff_latest({ agent_id: "hermes", project_id })
       │    └─> GET /api/handoffs/latest
       │         └─> Returns latest unconsumed handoff
       ├─> Caches bundle for pre_llm_call to inject into model context
       └─> MCP: dashclaw_handoff_consume({ id: hf_*, session_id })
            └─> POST /api/handoffs/:id/consume (sets consumed_at)

Pre-LLM call (every turn until cache expires)
  └─> .hermes/hooks/dashclaw_pre_llm_hermes.py
       └─> Reads cached handoff bundle from on_session_start
            └─> Injects: "Previous session: <summary>. Open loops: <list>."
                 via Hermes context-injection contract
```

## Error handling

- Handoff lookup with no match: return 404, MCP tool returns `null` (not an error) — handoffs are best-effort, not required
- Handoff consume on already-consumed: idempotent, no error (sets `consumed_at` only if currently null)
- Secret rotation due with no overdue secrets: return empty array, not 404
- Skill scan with unparseable content: scan still runs (treats content as text), but emits a `low` severity `parse-error` finding
- All routes follow the existing route-SQL guardrail: SQL lives in repositories under `app/lib/repositories/`, not in route files

## Testing strategy

Per phase, atomic commits:

**Schema phase:**
- Drizzle migration applies cleanly on empty DB (integration test)
- Each new table's foreign keys cascade correctly (handoffs.org_id, secrets.org_id, skill_scan_results.org_id)

**Repository phase:**
- Unit tests per new repository function: `code-session-handoffs.repository.test.js`, `governed-secrets.repository.test.js`, `skill-scan-results.repository.test.js`
- Each test mocks `sql` per the existing pattern (see `monetization-repository.test.js`)

**Route phase:**
- Integration test per route: 8 new routes + any new `/api/loops` routes if added
- Tests cover: happy path, 404, 400 (validation), 401 (no api key), 500 (db error fallback)

**MCP phase:**
- Tool registration test: all 12 new tools appear in the MCP `tools/list` response
- Per-tool contract test: input schema + happy-path response shape

**E2E phase:**
- One full Hermes handoff loop: end session N → handoff created → start session N+1 → handoff consumed → bundle present in pre_llm_call injection
- Skill-scan flow: scan a known-bad skill → high finding → `passed=false`; rescan same content → returns cached result without re-running detector

**Skill content phase:**
- `dashclaw-governance` SKILL.md test: regex assertion that each of the six new "when to use" sections is present
- `dashclaw-platform-intelligence` regen test: after livingcode refresh, `api-surface.md` references the 12 new MCP tools

**Retirement phase:**
- Test that `app/toolkit/page.js` no longer exists (or returns the redirect)
- Test that `agent-tools/` is gone (filesystem assertion in repo health test)
- Test that nav/footer links don't reference `/toolkit`

## Sequencing

Inside a single feature branch, phased commits in order:

1. `feat(schema): add code_session_handoffs, governed_secrets, skill_scan_results tables`
2. `feat(repo): handoff, secret, skill-scan repository functions + unit tests`
3. `feat(api): 8 new routes for handoffs / secrets / skills`
4. `feat(api): MCP wrappers — open-loops routes (if needed), audit-log filter route`
5. `feat(mcp): 12 new MCP tools in mcp-server/lib/tools.js + contract tests`
6. `feat(hooks): Hermes on_session_end / on_session_start handoff wiring`
7. `feat(skills): governance skill — 6 new "when to use" sections`
8. `feat(skills): livingcode refresh to propagate platform-intelligence updates`
9. `chore(toolkit): retire agent-tools/, /toolkit page, nav links, doc references`
10. `docs: PROJECT_DETAILS.md + README.md + CLAUDE.md updates`

Each phase atomically commits. Last is the retirement so the new surface is live before the old one disappears.

## Open questions resolved

- **MCP naming convention:** terser (`dashclaw_handoff_*` not `dashclaw_session_handoff_*`). Matches existing `dashclaw_guard` / `dashclaw_record` precedent.
- **Handoff scoping:** project-scoped with agent fallback. `project_id` nullable in `code_session_handoffs`. Solves multi-project per-agent case without forcing project context when none exists.
- **Decisions tool granularity:** one tool (`dashclaw_decisions_recent`) with optional filters, not two (`dashclaw_decisions_recent` + `dashclaw_actions_recent`). Single tool keeps cognitive load on DashClaw rather than the agent.
- **Toolkit page replacement:** redirect to `/docs#mcp-tools` rather than 410 Gone. Preserves any inbound links / bookmarks / search engine indexes while pointing users at the live equivalent.
