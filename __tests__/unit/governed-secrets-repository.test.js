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
