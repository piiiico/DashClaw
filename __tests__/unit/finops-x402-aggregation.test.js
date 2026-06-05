import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getX402SpendAggregation } from '@/lib/repositories/x402.repository.js';

let sql;
beforeEach(() => { sql = vi.fn(); });

describe('getX402SpendAggregation', () => {
  it('sums spend_amount from x402_purchases, org-scoped, with by_day + by_provider', async () => {
    sql.mockResolvedValueOnce([{ total_spend_usd: 1.25, purchase_count: 3 }]); // total
    sql.mockResolvedValueOnce([{ date: '2026-06-05', spend_usd: 1.25, purchase_count: 3 }]); // by_day
    sql.mockResolvedValueOnce([{ provider_id: 'prov_x', spend_usd: 1.25, purchase_count: 3 }]); // by_provider
    const out = await getX402SpendAggregation(sql, 'org_1', { period: '30d' });
    expect(out.total_spend_usd).toBe(1.25);
    expect(out.by_day).toHaveLength(1);
    expect(out.by_provider[0].provider_id).toBe('prov_x');
    const allSql = sql.mock.calls.map((c) => c[0].join(' ')).join(' || ');
    expect(allSql).toContain('FROM x402_purchases');
    expect(allSql).toContain('SUM(spend_amount)');
    const boundValues = sql.mock.calls.flatMap((c) => c.slice(1));
    expect(boundValues).toContain('org_1');
  });
});
