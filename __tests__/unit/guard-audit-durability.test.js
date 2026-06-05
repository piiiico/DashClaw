import { describe, it, expect } from 'vitest';
import { evaluateGuard } from '@/lib/guard.js';

// Minimal tagged-template sql: returns [] for every query EXCEPT it can be told
// to reject the required guard_decisions audit INSERT, so we can assert the
// engine does not return a "success" decision when its audit row is lost.
function makeSql({ failInsert = false } = {}) {
  const fn = async (strings, ...values) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (text.includes('INSERT INTO guard_decisions')) {
      if (failInsert) throw new Error('audit write failed');
      return [];
    }
    return [];
  };
  fn.query = async () => [];
  return fn;
}

describe('durable guard audit evidence (R2)', () => {
  it('returns a decision when the required audit row persists', async () => {
    const sql = makeSql({ failInsert: false });
    const res = await evaluateGuard('org_1', { action_type: 'read', agent_id: 'a1' }, sql);
    expect(res.decision).toBe('allow');
  });

  it('throws instead of silently returning success when the audit row fails to persist', async () => {
    const sql = makeSql({ failInsert: true });
    await expect(
      evaluateGuard('org_1', { action_type: 'read', agent_id: 'a1' }, sql),
    ).rejects.toThrow();
  });
});
