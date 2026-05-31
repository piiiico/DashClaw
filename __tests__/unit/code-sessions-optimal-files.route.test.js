/**
 * Covers the three optimal-files routes under
 *   /api/code-sessions/sessions/[sessionId]/optimal-files/*
 *
 *   POST preview        -> builds the bundle, returns it
 *   POST merge-preview  -> builds the bundle, previews a single-file merge
 *   POST manifest       -> validates selections against the bundle allowlist,
 *                          plans, and persists a manifest
 *
 * The pure bundle builder/planner (lib/claude-code/optimal-files/bundle.js)
 * and the repository are mocked, so these tests pin route-level wiring:
 * not_found handling, body validation, the allowlist/in-bundle gate on
 * manifest, and content-override application.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockGetOrgId,
  mockGetSessionDetail,
  mockGetProjectMedianCost,
  mockGetSimilarSessionCount,
  mockSaveManifest,
  mockBuildOptimalFilesBundle,
  mockPlanBundleSelections,
  mockPreviewBundleMerge,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetOrgId: vi.fn(),
  mockGetSessionDetail: vi.fn(),
  mockGetProjectMedianCost: vi.fn(),
  mockGetSimilarSessionCount: vi.fn(),
  mockSaveManifest: vi.fn(),
  mockBuildOptimalFilesBundle: vi.fn(),
  mockPlanBundleSelections: vi.fn(),
  mockPreviewBundleMerge: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId }));
vi.mock('@/lib/repositories/code-sessions.repository.js', () => ({
  getSessionDetail: mockGetSessionDetail,
  getProjectMedianCost: mockGetProjectMedianCost,
  getSimilarSessionCount: mockGetSimilarSessionCount,
  saveManifest: mockSaveManifest,
}));
vi.mock('@/lib/claude-code/optimal-files/bundle.js', () => ({
  buildOptimalFilesBundle: mockBuildOptimalFilesBundle,
  planBundleSelections: mockPlanBundleSelections,
  previewBundleMerge: mockPreviewBundleMerge,
}));

import { POST as POST_PREVIEW } from '@/api/code-sessions/sessions/[sessionId]/optimal-files/preview/route.js';
import { POST as POST_MERGE } from '@/api/code-sessions/sessions/[sessionId]/optimal-files/merge-preview/route.js';
import { POST as POST_MANIFEST } from '@/api/code-sessions/sessions/[sessionId]/optimal-files/manifest/route.js';

function ctx(sessionId = 'cs_1') {
  return { params: Promise.resolve({ sessionId }) };
}

function req(body) {
  return makeRequest('http://localhost/api/code-sessions/sessions/cs_1/optimal-files', {
    headers: { 'x-org-id': 'org_test' },
    body,
  });
}

const SESSION_DETAIL = {
  session: {
    id: 'cs_1',
    project_id: 'cp_1',
    project_slug: 'demo',
    project_cwd: 'C:/Projects/Demo',
  },
  toolUses: [
    { name: 'Read', request_id: 'R1', target: 'a.js' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_test');
  mockGetSessionDetail.mockResolvedValue(SESSION_DETAIL);
  mockGetProjectMedianCost.mockResolvedValue(0.1);
  mockGetSimilarSessionCount.mockResolvedValue(2);
  mockBuildOptimalFilesBundle.mockReturnValue({
    bundle: [
      { path: 'CLAUDE.md', kind: 'memory', title: 'Memory', reason: 'r', confidence: 'high', group: 'g', commitRecommendation: 'commit', content: '# Memory', secretScan: { clean: true }, overwriteRisk: 'unknown', virtual: false },
    ],
    groups: [{ id: 'g', title: 'Group' }],
    analysis: { summary: 'ok' },
  });
});

describe('POST optimal-files/preview', () => {
  it('returns the built bundle for a valid session', async () => {
    const res = await POST_PREVIEW(req(undefined), ctx('cs_1'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session_id).toBe('cs_1');
    expect(body.bundle).toHaveLength(1);
    expect(body.bundle[0].path).toBe('CLAUDE.md');
    expect(body.bundle[0].commit_recommendation).toBe('commit');
    expect(body.groups).toEqual([{ id: 'g', title: 'Group' }]);

    // Wiring: repository + builder are called with org-scoped session context.
    expect(mockGetSessionDetail).toHaveBeenCalledWith(mockSql, 'org_test', 'cs_1');
    expect(mockBuildOptimalFilesBundle).toHaveBeenCalledTimes(1);
    const buildArg = mockBuildOptimalFilesBundle.mock.calls[0][0];
    expect(buildArg.projectCwd).toBe('C:/Projects/Demo');
    expect(buildArg.projectMedianCost).toBe(0.1);
    expect(buildArg.similarSessionCount).toBe(2);
  });

  it('returns 404 when the session does not exist', async () => {
    mockGetSessionDetail.mockResolvedValue(null);
    const res = await POST_PREVIEW(req(undefined), ctx('cs_missing'));
    expect(res.status).toBe(404);
    expect(mockBuildOptimalFilesBundle).not.toHaveBeenCalled();
  });
});

describe('POST optimal-files/merge-preview', () => {
  it('previews the merge for an in-bundle path', async () => {
    mockPreviewBundleMerge.mockReturnValue({ status: 'no_existing_supplied', path: 'CLAUDE.md' });

    const res = await POST_MERGE(req({ path: 'CLAUDE.md' }), ctx('cs_1'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('no_existing_supplied');
    expect(mockPreviewBundleMerge).toHaveBeenCalledTimes(1);
    const arg = mockPreviewBundleMerge.mock.calls[0][0];
    expect(arg.filePath).toBe('CLAUDE.md');
    expect(arg.existingContent).toBeNull(); // server cannot read the user's disk
  });

  it('returns 400 when path is missing', async () => {
    const res = await POST_MERGE(req({}), ctx('cs_1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_path');
    expect(mockGetSessionDetail).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid JSON body', async () => {
    const badReq = {
      url: 'http://localhost/api/code-sessions/sessions/cs_1/optimal-files/merge-preview',
      headers: new Headers({ 'x-org-id': 'org_test' }),
      json: async () => { throw new Error('bad json'); },
      nextUrl: new URL('http://localhost/api/code-sessions/sessions/cs_1/optimal-files/merge-preview'),
    };
    const res = await POST_MERGE(badReq, ctx('cs_1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
  });

  it('returns 404 when the session is not found', async () => {
    mockGetSessionDetail.mockResolvedValue(null);
    const res = await POST_MERGE(req({ path: 'CLAUDE.md' }), ctx('cs_missing'));
    expect(res.status).toBe(404);
    expect(mockPreviewBundleMerge).not.toHaveBeenCalled();
  });
});

describe('POST optimal-files/manifest', () => {
  beforeEach(() => {
    mockPlanBundleSelections.mockReturnValue({
      results: [{ path: 'CLAUDE.md', status: 'create', content: '# Memory', edited: false }],
    });
    mockSaveManifest.mockResolvedValue({
      id: 'cofm_1',
      expires_at: '2026-05-14T00:00:00Z',
    });
  });

  it('saves a manifest for valid in-bundle selections', async () => {
    const res = await POST_MANIFEST(req({ selections: [{ path: 'CLAUDE.md' }] }), ctx('cs_1'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.manifest_id).toBe('cofm_1');
    expect(body.expires_at).toBe('2026-05-14T00:00:00Z');
    expect(body.apply_command).toContain('dashclaw code apply cofm_1');
    expect(body.apply_command).toContain('C:/Projects/Demo');

    expect(mockSaveManifest).toHaveBeenCalledTimes(1);
    const [, orgArg, sessionArg, cwdArg, planArg, ttlArg] = mockSaveManifest.mock.calls[0];
    expect(orgArg).toBe('org_test');
    expect(sessionArg).toBe('cs_1');
    expect(cwdArg).toBe('C:/Projects/Demo');
    expect(planArg).toHaveLength(1);
    expect(ttlArg).toBe(24);
  });

  it('applies caller-supplied content overrides onto the plan results', async () => {
    await POST_MANIFEST(
      req({ selections: [{ path: 'CLAUDE.md', content: 'OVERRIDDEN' }] }),
      ctx('cs_1'),
    );

    // The route mutates plan.results in place before persisting.
    const planArg = mockSaveManifest.mock.calls[0][4];
    expect(planArg[0].content).toBe('OVERRIDDEN');
    expect(planArg[0].edited).toBe(true);
  });

  it('returns 400 when selections is missing', async () => {
    const res = await POST_MANIFEST(req({}), ctx('cs_1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing_selections');
    expect(mockGetSessionDetail).not.toHaveBeenCalled();
  });

  it('rejects a path outside the .claude allowlist with invalid_path', async () => {
    const res = await POST_MANIFEST(
      req({ selections: [{ path: 'src/secrets.js' }] }),
      ctx('cs_1'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_path');
    expect(body.path).toBe('src/secrets.js');
    expect(mockSaveManifest).not.toHaveBeenCalled();
  });

  it('rejects an allowlisted path that is not present in the built bundle', async () => {
    // .claude/rules/ is allowlisted but not in the mocked bundle (only CLAUDE.md is).
    const res = await POST_MANIFEST(
      req({ selections: [{ path: '.claude/rules/foo.md' }] }),
      ctx('cs_1'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('path_not_in_bundle');
    expect(mockSaveManifest).not.toHaveBeenCalled();
  });

  it('returns 404 when the session is not found', async () => {
    mockGetSessionDetail.mockResolvedValue(null);
    const res = await POST_MANIFEST(req({ selections: [{ path: 'CLAUDE.md' }] }), ctx('cs_missing'));
    expect(res.status).toBe(404);
    expect(mockSaveManifest).not.toHaveBeenCalled();
  });
});
