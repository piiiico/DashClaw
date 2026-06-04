import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// B1: the migration must be idempotent, org-scoped Postgres DDL creating the
// three reputation tables. (It was also applied + verified against the live
// Neon DB during development.)
const sql = readFileSync(join(process.cwd(), 'drizzle', '0018_agent_reputation.sql'), 'utf8');

describe('drizzle/0018_agent_reputation.sql (B1)', () => {
  it('creates the three reputation tables idempotently', () => {
    for (const table of ['agent_reputation_events', 'agent_reputation_snapshots', 'agent_reputation_receipts']) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
  });

  it('every table is org-scoped with an org_id column', () => {
    const tables = sql.split('CREATE TABLE IF NOT EXISTS').slice(1);
    expect(tables.length).toBe(3);
    for (const t of tables) {
      expect(t).toMatch(/"org_id" TEXT NOT NULL/);
    }
  });

  it('uses idempotent index creation and the statement-breakpoint separator', () => {
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS');
    expect(sql).toContain('--> statement-breakpoint');
  });

  it('the snapshot table has a unique (org_id, agent_id) constraint for upsert', () => {
    expect(sql).toMatch(/UNIQUE \("org_id", "agent_id"\)/);
  });

  it('includes the full reputation vector columns on the snapshot table', () => {
    for (const col of [
      'reliability_score', 'completion_rate', 'policy_violation_rate', 'approval_adherence',
      'quality_score', 'risk_score', 'volume_weight', 'confidence', 'total_events',
      'last_event_at', 'computed_at', 'vector_hash',
    ]) {
      expect(sql).toContain(`"${col}"`);
    }
  });
});
