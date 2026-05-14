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
    expect(sql.calls[0].text).toMatch(/ON CONFLICT[\s\S]*DO UPDATE/i);
  });

  it('getScanById returns row by primary key', async () => {
    const sql = makeSqlMock([{ id: 'scn_1' }]);
    const result = await getScanById(sql, 'org_1', 'scn_1');
    expect(result.id).toBe('scn_1');
  });
});
