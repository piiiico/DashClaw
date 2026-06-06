import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostureFinding, PostureScore } from '../../app/lib/posture/types';

/**
 * Tests for POST /api/posture/scan — recompute + persist a trend snapshot.
 */

const m = vi.hoisted(() => ({
  sql: vi.fn(async () => []),
  computePosturePayload: vi.fn(),
  insertPostureSnapshot: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => m.sql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));
vi.mock('@/lib/posture/signals.js', () => ({ computePosturePayload: m.computePosturePayload }));
vi.mock('@/lib/repositories/posture.repository.js', () => ({ insertPostureSnapshot: m.insertPostureSnapshot }));

const { POST } = await import('@/api/posture/scan/route.js');

const score: PostureScore = {
  score: 72,
  status: 'needs_attention',
  cappedBy: null,
  dimensions: [
    { dimension: 'enforcement', score: 61, weight: 20 },
    { dimension: 'spend', score: 45, weight: 8 },
  ],
};

function finding(status: PostureFinding['status']): PostureFinding {
  return {
    key: `k-${status}`, dimension: 'enforcement', severity: 'high', title: 't',
    evidence: { observedCount: 1, exampleActionIds: [] }, scoreDelta: 3,
    fix: { type: 'create_policy_draft', policyType: 'risk_threshold', rules: {} }, status,
  };
}

function req(): Request {
  return new Request('http://localhost/api/posture/scan', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.computePosturePayload.mockResolvedValue({
    score,
    findings: [finding('open'), finding('drafted'), finding('snoozed')],
    unitCount: 4,
  });
  m.insertPostureSnapshot.mockResolvedValue({ id: 'psnap_1', score: 72, dimensions: score.dimensions, createdAt: '2026-06-06T03:00:00Z' });
});

describe('POST /api/posture/scan', () => {
  it('returns 200 with score + persisted snapshot', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.score).toBe(72);
    expect(body.status).toBe('needs_attention');
    expect((body.snapshot as { id: string }).id).toBe('psnap_1');
  });

  it('persists exactly one snapshot with the computed score + dimensions', async () => {
    await POST(req());
    expect(m.insertPostureSnapshot).toHaveBeenCalledOnce();
    const [, orgId, snapScore, dims] = (m.insertPostureSnapshot.mock.calls as unknown as unknown[][])[0]!;
    expect(orgId).toBe('org_test');
    expect(snapScore).toBe(72);
    expect(dims).toEqual(score.dimensions);
  });

  it('summary.openFindings counts open + drafted (drops snoozed)', async () => {
    const res = await POST(req());
    const body = await res.json() as { summary: { openFindings: number } };
    expect(body.summary.openFindings).toBe(2);
  });

  it('returns 500 when the recompute throws', async () => {
    m.computePosturePayload.mockRejectedValue(new Error('DB down'));
    const res = await POST(req());
    expect(res.status).toBe(500);
  });
});
