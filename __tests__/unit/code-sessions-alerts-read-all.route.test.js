import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockGetOrgId,
  mockMarkAlertsRead,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetOrgId: vi.fn(),
  mockMarkAlertsRead: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId }));
vi.mock('@/lib/repositories/code-sessions.repository.js', () => ({
  markAlertsRead: mockMarkAlertsRead,
}));

import { POST } from '@/api/code-sessions/alerts/read-all/route.js';

function req(body) {
  return makeRequest('http://localhost/api/code-sessions/alerts/read-all', {
    headers: { 'x-org-id': 'org_test' },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_test');
  mockMarkAlertsRead.mockResolvedValue(0);
});

describe('POST /api/code-sessions/alerts/read-all', () => {
  it('marks all unread alerts read when no ids are supplied', async () => {
    mockMarkAlertsRead.mockResolvedValue(5);

    const res = await POST(req({}));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.marked).toBe(5);
    // No ids -> repository receives null so it marks everything unread.
    expect(mockMarkAlertsRead).toHaveBeenCalledWith(mockSql, 'org_test', null);
  });

  it('marks only the supplied numeric ids when ids[] is provided', async () => {
    mockMarkAlertsRead.mockResolvedValue(2);

    const res = await POST(req({ ids: [10, 20] }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.marked).toBe(2);
    expect(mockMarkAlertsRead).toHaveBeenCalledWith(mockSql, 'org_test', [10, 20]);
  });

  it('coerces string ids to integers and drops non-numeric entries', async () => {
    await POST(req({ ids: ['7', 'abc', '9', null] }));

    // '7' and '9' survive parseInt + Number.isFinite; 'abc' and null are dropped.
    expect(mockMarkAlertsRead).toHaveBeenCalledWith(mockSql, 'org_test', [7, 9]);
  });

  it('tolerates an empty/invalid body (passes ids=null)', async () => {
    // The route swallows a JSON parse error and treats body as {}.
    const badReq = {
      url: 'http://localhost/api/code-sessions/alerts/read-all',
      headers: new Headers({ 'x-org-id': 'org_test' }),
      json: async () => { throw new Error('no body'); },
      nextUrl: new URL('http://localhost/api/code-sessions/alerts/read-all'),
    };

    const res = await POST(badReq);

    expect(res.status).toBe(200);
    expect(mockMarkAlertsRead).toHaveBeenCalledWith(mockSql, 'org_test', null);
  });
});
