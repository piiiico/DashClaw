/**
 * Covers the two memo routes:
 *   GET  /api/code-sessions/memos            -> list memos for a project
 *   POST /api/code-sessions/memos/regenerate -> regenerate + persist a memo
 *
 * Both resolve the project by id (cp_*) or slug via listProjects. memo
 * generation (lib/claude-code/memo.js) is mocked so the regenerate test pins
 * the route's project-resolution + persistence wiring, not the memo content.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockGetOrgId,
  mockListProjects,
  mockListMemos,
  mockSaveMemo,
  mockGetProjectSessionsChronological,
  mockGenerateMemo,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetOrgId: vi.fn(),
  mockListProjects: vi.fn(),
  mockListMemos: vi.fn(),
  mockSaveMemo: vi.fn(),
  mockGetProjectSessionsChronological: vi.fn(),
  mockGenerateMemo: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId }));
vi.mock('@/lib/repositories/code-sessions.repository.js', () => ({
  listProjects: mockListProjects,
  listMemos: mockListMemos,
  saveMemo: mockSaveMemo,
  getProjectSessionsChronological: mockGetProjectSessionsChronological,
}));
vi.mock('@/lib/claude-code/memo.js', () => ({ generateMemo: mockGenerateMemo }));

import { GET } from '@/api/code-sessions/memos/route.js';
import { POST } from '@/api/code-sessions/memos/regenerate/route.js';

function getReq(query = '') {
  return makeRequest(`http://localhost/api/code-sessions/memos${query}`, {
    headers: { 'x-org-id': 'org_test' },
  });
}
function postReq(query = '') {
  return makeRequest(`http://localhost/api/code-sessions/memos/regenerate${query}`, {
    headers: { 'x-org-id': 'org_test' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_test');
});

describe('GET /api/code-sessions/memos', () => {
  it('returns memos when given a project id directly', async () => {
    mockListMemos.mockResolvedValue([{ id: 'm1', iso_week_tag: '2026-W20', body_md: '# Memo' }]);

    const res = await GET(getReq('?project=cp_1'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memos).toHaveLength(1);
    // cp_ prefix skips slug resolution.
    expect(mockListProjects).not.toHaveBeenCalled();
    expect(mockListMemos).toHaveBeenCalledWith(mockSql, 'org_test', 'cp_1');
  });

  it('resolves a slug to a project id before listing memos', async () => {
    mockListProjects.mockResolvedValue([{ id: 'cp_9', slug: 'demo' }]);
    mockListMemos.mockResolvedValue([]);

    const res = await GET(getReq('?project=demo'));

    expect(res.status).toBe(200);
    expect(mockListProjects).toHaveBeenCalledTimes(1);
    expect(mockListMemos).toHaveBeenCalledWith(mockSql, 'org_test', 'cp_9');
  });

  it('returns 400 when the project param is missing', async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing_project');
    expect(mockListMemos).not.toHaveBeenCalled();
  });

  it('returns 404 when the slug does not resolve to a project', async () => {
    mockListProjects.mockResolvedValue([{ id: 'cp_9', slug: 'other' }]);

    const res = await GET(getReq('?project=ghost'));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('project_not_found');
    expect(mockListMemos).not.toHaveBeenCalled();
  });
});

describe('POST /api/code-sessions/memos/regenerate', () => {
  beforeEach(() => {
    mockListProjects.mockResolvedValue([{ id: 'cp_1', slug: 'demo' }]);
    mockGetProjectSessionsChronological.mockResolvedValue([]);
    mockGenerateMemo.mockReturnValue({
      weekTag: '2026-W22',
      markdown: '# Weekly memo',
      summary: { sessions: 0 },
    });
    mockSaveMemo.mockResolvedValue({ id: 'm_new', iso_week_tag: '2026-W22', body_md: '# Weekly memo' });
  });

  it('regenerates and persists a memo for a project resolved by id', async () => {
    const res = await POST(postReq('?project_id=cp_1'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memo.id).toBe('m_new');
    expect(body.summary).toEqual({ sessions: 0 });

    expect(mockGenerateMemo).toHaveBeenCalledTimes(1);
    expect(mockSaveMemo).toHaveBeenCalledWith(
      mockSql,
      'org_test',
      'cp_1',
      '2026-W22',
      '# Weekly memo',
    );
  });

  it('resolves a project by slug as well', async () => {
    const res = await POST(postReq('?project=demo'));
    expect(res.status).toBe(200);
    expect(mockSaveMemo).toHaveBeenCalledWith(mockSql, 'org_test', 'cp_1', '2026-W22', '# Weekly memo');
  });

  it('returns 400 when no project param is supplied', async () => {
    const res = await POST(postReq());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing_project');
    expect(mockGenerateMemo).not.toHaveBeenCalled();
  });

  it('returns 404 when the project cannot be resolved', async () => {
    mockListProjects.mockResolvedValue([{ id: 'cp_1', slug: 'demo' }]);
    const res = await POST(postReq('?project_id=cp_nope'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('project_not_found');
    expect(mockSaveMemo).not.toHaveBeenCalled();
  });
});
