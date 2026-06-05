import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCostAggregation } from '@/lib/repositories/actions.repository.js';

let sql;
beforeEach(() => { sql = vi.fn().mockResolvedValue([{ total_cost_usd: 0, total_tokens_in: 0, total_tokens_out: 0 }]); });

describe('getCostAggregation — Agent Spend excludes x402 purchases', () => {
  it('adds an action_type <> x402_purchase filter to all three rollup queries', async () => {
    await getCostAggregation(sql, 'org_1', { period: '30d' });
    const allSql = sql.mock.calls.map((c) => c[0].join(' ')).join(' || ');
    const matches = allSql.match(/action_type <> 'x402_purchase'/g) || [];
    expect(matches.length).toBe(3); // total + by_agent + by_day each exclude x402
  });

  it('stays org-scoped', async () => {
    await getCostAggregation(sql, 'org_1', { period: '7d' });
    const boundValues = sql.mock.calls.flatMap((c) => c.slice(1));
    expect(boundValues).toContain('org_1');
  });
});
