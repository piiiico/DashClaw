import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('migration 0007 — agent toolkit into runtime', () => {
  const sql = readFileSync(path.resolve('drizzle/0007_agent_toolkit_into_runtime.sql'), 'utf8');

  it('creates three new tables', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS code_session_handoffs/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS governed_secrets/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS skill_scan_results/);
  });

  it('declares org_id foreign keys on every new table', () => {
    const fks = sql.match(/REFERENCES organizations\(id\)/g) || [];
    expect(fks.length).toBeGreaterThanOrEqual(3);
  });

  it('handoffs table has project_id with SET NULL cascade', () => {
    expect(sql).toMatch(/project_id\s+TEXT\s+REFERENCES\s+code_projects\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i);
  });

  it('governed_secrets has unique constraint per (org_id, agent_id, name)', () => {
    expect(sql).toMatch(/UNIQUE\s*\(\s*org_id\s*,\s*agent_id\s*,\s*name\s*\)/);
  });

  it('skill_scan_results dedupes per (org_id, skill_name, target_hash)', () => {
    expect(sql).toMatch(/UNIQUE\s*\(\s*org_id\s*,\s*skill_name\s*,\s*target_hash\s*\)/);
  });

  it('lookup index on handoffs supports the project+agent+freshness query', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS code_session_handoffs_lookup_idx/);
  });
});
