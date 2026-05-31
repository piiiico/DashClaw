/**
 * Covers the two read-only session routes:
 *   GET /api/code-sessions/sessions/[sessionId]          -> getSessionDetail passthrough
 *   GET /api/code-sessions/sessions/[sessionId]/autopsy  -> buildAutopsy over the detail
 *
 * Both depend only on the repository + (for autopsy) the pure claude-code
 * helpers, which we mock so the assertions pin route behavior, not the
 * heuristics inside those libs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockGetOrgId,
  mockGetSessionDetail,
  mockDetectRepeatedRuns,
  mockBuildAutopsy,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetOrgId: vi.fn(),
  mockGetSessionDetail: vi.fn(),
  mockDetectRepeatedRuns: vi.fn(),
  mockBuildAutopsy: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId }));
vi.mock('@/lib/repositories/code-sessions.repository.js', () => ({
  getSessionDetail: mockGetSessionDetail,
}));
vi.mock('@/lib/claude-code/repeated-runs.js', () => ({ detectRepeatedRuns: mockDetectRepeatedRuns }));
vi.mock('@/lib/claude-code/goals.js', () => ({ buildAutopsy: mockBuildAutopsy }));

import { GET as GET_DETAIL } from '@/api/code-sessions/sessions/[sessionId]/route.js';
import { GET as GET_AUTOPSY } from '@/api/code-sessions/sessions/[sessionId]/autopsy/route.js';

function ctx(sessionId) {
  return { params: Promise.resolve({ sessionId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_test');
  mockDetectRepeatedRuns.mockReturnValue([]);
  mockBuildAutopsy.mockReturnValue({ verdict: 'unknown', goals: [] });
});

describe('GET /api/code-sessions/sessions/[sessionId]', () => {
  it('returns the session detail when it exists in the org', async () => {
    const detail = {
      session: { id: 'cs_1', session_uuid: 'sess-1', project_id: 'cp_1' },
      messages: [],
      toolUses: [],
    };
    mockGetSessionDetail.mockResolvedValue(detail);

    const res = await GET_DETAIL(
      makeRequest('http://localhost/api/code-sessions/sessions/cs_1'),
      ctx('cs_1'),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.id).toBe('cs_1');
    expect(mockGetSessionDetail).toHaveBeenCalledWith(mockSql, 'org_test', 'cs_1');
  });

  it('returns 404 when the session is not found', async () => {
    mockGetSessionDetail.mockResolvedValue(null);

    const res = await GET_DETAIL(
      makeRequest('http://localhost/api/code-sessions/sessions/cs_missing'),
      ctx('cs_missing'),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not_found');
  });
});

describe('GET /api/code-sessions/sessions/[sessionId]/autopsy', () => {
  it('builds an autopsy from the session detail', async () => {
    mockGetSessionDetail.mockResolvedValue({
      session: { id: 'cs_1', session_uuid: 'sess-1' },
      messages: [
        { role: 'user', text_preview: 'fix the build' },
        { role: 'assistant', text_preview: 'all tests pass, done' },
      ],
      toolUses: [
        { name: 'Bash', request_id: 'R1', target: 'npm test' },
      ],
    });
    const autopsy = { verdict: 'success', goals: [{ text: 'fix the build', met: true }] };
    mockBuildAutopsy.mockReturnValue(autopsy);

    const res = await GET_AUTOPSY(
      makeRequest('http://localhost/api/code-sessions/sessions/cs_1/autopsy'),
      ctx('cs_1'),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verdict).toBe('success');

    // The route extracts user turns + detects a final-summary cue and passes
    // them into buildAutopsy. Assert the wiring rather than the heuristic.
    expect(mockBuildAutopsy).toHaveBeenCalledTimes(1);
    const arg = mockBuildAutopsy.mock.calls[0][0];
    expect(arg.userTurns).toEqual(['fix the build']);
    expect(arg.hasFinalSummary).toBe(true); // "all tests pass, done" matches the summary cue
    expect(arg.toolEvents).toHaveLength(1);
    expect(arg.toolEvents[0].name).toBe('Bash');
  });

  it('marks hasFinalSummary false when the last assistant turn has no completion cue', async () => {
    mockGetSessionDetail.mockResolvedValue({
      session: { id: 'cs_1' },
      messages: [
        { role: 'user', text_preview: 'add a feature' },
        { role: 'assistant', text_preview: 'still working on it' },
      ],
      toolUses: [],
    });

    const res = await GET_AUTOPSY(
      makeRequest('http://localhost/api/code-sessions/sessions/cs_1/autopsy'),
      ctx('cs_1'),
    );

    expect(res.status).toBe(200);
    const arg = mockBuildAutopsy.mock.calls[0][0];
    expect(arg.hasFinalSummary).toBe(false);
  });

  it('returns 404 when the session is not found', async () => {
    mockGetSessionDetail.mockResolvedValue(null);

    const res = await GET_AUTOPSY(
      makeRequest('http://localhost/api/code-sessions/sessions/cs_missing/autopsy'),
      ctx('cs_missing'),
    );

    expect(res.status).toBe(404);
    expect(mockBuildAutopsy).not.toHaveBeenCalled();
  });
});
