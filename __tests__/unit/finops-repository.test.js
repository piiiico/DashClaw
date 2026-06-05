import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ getCostAggregation: vi.fn(), getX402SpendAggregation: vi.fn() }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({ getCostAggregation: m.getCostAggregation }));
vi.mock('@/lib/repositories/x402.repository.js', () => ({ getX402SpendAggregation: m.getX402SpendAggregation }));

const { getFleetSpend } = await import('@/lib/repositories/finops.repository.js');
const sql = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  m.getCostAggregation.mockResolvedValue({ total_cost_usd: 10, by_day: [{ date: '2026-06-05', cost_usd: 10 }], by_agent: [{ agent_id: 'a1', cost_usd: 10 }] });
  m.getX402SpendAggregation.mockResolvedValue({ total_spend_usd: 2.5, by_day: [{ date: '2026-06-05', spend_usd: 2.5 }], by_provider: [{ provider_id: 'prov_x', spend_usd: 2.5 }] });
});

describe('getFleetSpend', () => {
  it('composes agent + x402 spend and sums the fleet total', async () => {
    const out = await getFleetSpend(sql, 'org_1', { period: '30d' });
    expect(m.getCostAggregation).toHaveBeenCalledWith(sql, 'org_1', { period: '30d' });
    expect(m.getX402SpendAggregation).toHaveBeenCalledWith(sql, 'org_1', { period: '30d' });
    expect(out.lens).toBe('fleet');
    expect(out.agent.total_cost_usd).toBe(10);
    expect(out.x402.total_spend_usd).toBe(2.5);
    expect(out.fleet_total_usd).toBeCloseTo(12.5);
  });
});
