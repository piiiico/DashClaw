import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCodeSessionSpendAggregation } = await import('@/lib/repositories/code-sessions.repository.js');

let sql;
beforeEach(() => {
  // Three sequential sql calls: totals, by_day, by_project.
  sql = vi.fn()
    .mockResolvedValueOnce([{ total_cost_usd: 12.5, total_cache_savings_usd: 3.2, session_count: 4 }])
    .mockResolvedValueOnce([{ date: '2026-06-05', cost_usd: 12.5, session_count: 4 }])
    .mockResolvedValueOnce([{ project_id: 'cp_1', project_name: 'demo', cost_usd: 12.5, session_count: 4 }]);
});

describe('getCodeSessionSpendAggregation', () => {
  it('scopes every query to the org and the requested window, and returns totals + by_day + by_project', async () => {
    const out = await getCodeSessionSpendAggregation(sql, 'org_1', { period: '7d' });

    // org scoping is bound into every one of the three queries
    expect(sql.mock.calls).toHaveLength(3);
    for (const call of sql.mock.calls) expect(call).toContain('org_1');

    // the window bound is ~7 days back (period → days mapping)
    const sinceIso = sql.mock.calls[0].find((v) => typeof v === 'string' && v.includes('T'));
    const days = (Date.now() - new Date(sinceIso).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    // shape
    expect(out.period).toBe('7d');
    expect(out.total_cost_usd).toBe(12.5);
    expect(out.total_cache_savings_usd).toBe(3.2);
    expect(out.session_count).toBe(4);
    expect(out.by_day[0]).toMatchObject({ date: '2026-06-05', cost_usd: 12.5 });
    expect(out.by_project[0]).toMatchObject({ project_id: 'cp_1', project_name: 'demo' });
  });

  it('defaults an unknown period to a 30-day window', async () => {
    await getCodeSessionSpendAggregation(sql, 'org_1', { period: 'bogus' });
    const sinceIso = sql.mock.calls[0].find((v) => typeof v === 'string' && v.includes('T'));
    const days = (Date.now() - new Date(sinceIso).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });
});
