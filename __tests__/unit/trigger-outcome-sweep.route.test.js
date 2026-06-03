import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockGetOrgId, mockGetOrgRole, mockSweep, mockGetSettings } = vi.hoisted(() => ({
  mockSql: vi.fn(async () => []),
  mockGetOrgId: vi.fn(),
  mockGetOrgRole: vi.fn(),
  mockSweep: vi.fn(),
  mockGetSettings: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId, getOrgRole: mockGetOrgRole }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({ sweepLostOutcomesForOrg: mockSweep }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: mockGetSettings }));

import { POST } from '@/api/admin/trigger-outcome-sweep/route.js';

const url = 'http://localhost/api/admin/trigger-outcome-sweep';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_1');
  mockGetOrgRole.mockReturnValue('admin');
  mockGetSettings.mockResolvedValue([{ value: '15' }]);
  mockSweep.mockResolvedValue([{ action_id: 'act_1' }, { action_id: 'act_2' }]);
});

describe('POST /api/admin/trigger-outcome-sweep', () => {
  it('sweeps only the caller org and returns the swept count (admin)', async () => {
    const res = await POST(makeRequest(url, { body: {} }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, rows_swept: 2 });
    expect(mockSweep).toHaveBeenCalledTimes(1);
    expect(mockSweep.mock.calls[0][1]).toBe('org_1'); // org isolation
  });

  it('rejects non-admins with 403 and never sweeps', async () => {
    mockGetOrgRole.mockReturnValue('member');
    const res = await POST(makeRequest(url, { body: {} }));
    expect(res.status).toBe(403);
    expect(mockSweep).not.toHaveBeenCalled();
  });
});
