import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSql, mockGetFleetSpend } = vi.hoisted(() => ({ mockSql: vi.fn(), mockGetFleetSpend: vi.fn() }));
vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1' }));
vi.mock('@/lib/repositories/finops.repository.js', () => ({ getFleetSpend: mockGetFleetSpend }));

const { GET } = await import('@/api/finops/spend/route.js');
beforeEach(() => vi.clearAllMocks());

describe('GET /api/finops/spend', () => {
  it('returns the fleet rollup and passes the period through', async () => {
    mockGetFleetSpend.mockResolvedValue({ lens: 'fleet', fleet_total_usd: 12.5 });
    const res = await GET(new Request('http://localhost/api/finops/spend?period=7d'));
    expect(res.status).toBe(200);
    expect((await res.json()).fleet_total_usd).toBe(12.5);
    expect(mockGetFleetSpend).toHaveBeenCalledWith(mockSql, 'org_1', { period: '7d' });
  });

  it('defaults the period to 30d (and rejects an invalid period)', async () => {
    mockGetFleetSpend.mockResolvedValue({ lens: 'fleet', fleet_total_usd: 0 });
    await GET(new Request('http://localhost/api/finops/spend'));
    expect(mockGetFleetSpend).toHaveBeenCalledWith(mockSql, 'org_1', { period: '30d' });
    await GET(new Request('http://localhost/api/finops/spend?period=bogus'));
    expect(mockGetFleetSpend).toHaveBeenLastCalledWith(mockSql, 'org_1', { period: '30d' });
  });
});
