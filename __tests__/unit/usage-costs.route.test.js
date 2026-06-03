import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const mockSql = vi.fn(async () => []);
const mockGetOrgId = vi.fn(() => 'org_test');

vi.mock('../../app/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('../../app/lib/org.js', () => ({ getOrgId: (...a) => mockGetOrgId(...a) }));

const { GET } = await import('../../app/api/usage/costs/route.js');

function getReq(params = '') {
  return makeRequest(`http://localhost:3000/api/usage/costs${params}`, {
    headers: { 'x-org-id': 'org_test' },
  });
}

describe('GET /api/usage/costs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 (not 500) for a malformed period, before any SQL runs', async () => {
    const res = await GET(getReq('?period=garbage'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/period/i);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range month with 400 and no SQL', async () => {
    const res = await GET(getReq('?period=2026-13'));
    expect(res.status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('rejects a non-YYYY-MM shape with 400 and no SQL', async () => {
    const res = await GET(getReq('?period=2026-6-15'));
    expect(res.status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('returns 200 for a valid YYYY-MM period (no SQL touched before validation)', async () => {
    const res = await GET(getReq('?period=2026-06'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.period).toBe('2026-06');
  });

  it('defaults to the current period when the param is absent', async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.period).toMatch(/^\d{4}-\d{2}$/);
  });
});
