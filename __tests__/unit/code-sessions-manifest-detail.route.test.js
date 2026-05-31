import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockGetOrgId,
  mockGetManifest,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetOrgId: vi.fn(),
  mockGetManifest: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId }));
vi.mock('@/lib/repositories/code-sessions.repository.js', () => ({
  getManifest: mockGetManifest,
}));

import { GET } from '@/api/code-sessions/manifests/[manifestId]/route.js';

function ctx(manifestId) {
  return { params: Promise.resolve({ manifestId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_test');
});

describe('GET /api/code-sessions/manifests/[manifestId]', () => {
  it('returns the manifest when it exists and is unexpired', async () => {
    mockGetManifest.mockResolvedValue({
      id: 'cofm_1',
      session_id: 'cs_1',
      project_cwd: 'C:/Projects/Demo',
      plan: [{ path: 'CLAUDE.md', status: 'create' }],
      expires_at: '2026-05-14T00:00:00Z',
      created_at: '2026-05-13T00:00:00Z',
    });

    const res = await GET(
      makeRequest('http://localhost/api/code-sessions/manifests/cofm_1'),
      ctx('cofm_1'),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('cofm_1');
    expect(body.session_id).toBe('cs_1');
    expect(body.plan).toHaveLength(1);
    expect(mockGetManifest).toHaveBeenCalledWith(mockSql, 'org_test', 'cofm_1');
  });

  it('returns 404 when the manifest is missing or expired', async () => {
    // getManifest already filters on expires_at > NOW(), so an expired or
    // unknown id resolves to null here.
    mockGetManifest.mockResolvedValue(null);

    const res = await GET(
      makeRequest('http://localhost/api/code-sessions/manifests/cofm_gone'),
      ctx('cofm_gone'),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not_found_or_expired');
  });
});
