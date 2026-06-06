import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostureScore, PostureFinding } from '../../app/lib/posture/types';

/**
 * Tests for GET /api/posture.
 *
 * We mock the I/O boundary (signals.ts) and db/org helpers so the route test
 * only verifies: correct response shape, status code, and that no direct SQL
 * is issued from the route itself.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ─────────────────────────────────────────────────────────────────────────────

const m = vi.hoisted(() => ({
  sql: vi.fn(async () => []),
  computePosturePayload: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => m.sql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));
vi.mock('@/lib/posture/signals.js', () => ({ computePosturePayload: m.computePosturePayload }));

const { GET } = await import('@/api/posture/route.js');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeScore(overrides: Partial<PostureScore> = {}): PostureScore {
  return {
    score: 78,
    status: 'needs_attention',
    cappedBy: null,
    dimensions: [
      { dimension: 'enforcement', score: 80, weight: 20 },
      { dimension: 'identity', score: 70, weight: 10 },
      { dimension: 'spend', score: 90, weight: 5 },
      { dimension: 'auditability', score: 100, weight: 0 },
      { dimension: 'approval', score: 60, weight: 8 },
      { dimension: 'data_protection', score: 75, weight: 4 },
    ],
    ...overrides,
  };
}

function makeFinding(key: string, scoreDelta = 3): PostureFinding {
  return {
    key,
    dimension: 'enforcement',
    severity: 'high',
    title: `Unit "${key}" is not fully governed`,
    evidence: { observedCount: 5, exampleActionIds: [] },
    scoreDelta,
    fix: { type: 'create_policy_draft', policyType: 'risk_threshold', rules: {} },
    status: 'open',
  };
}

function getReq(): Request {
  return new Request('http://localhost/api/posture', { method: 'GET' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  m.computePosturePayload.mockResolvedValue({
    score: makeScore(),
    findings: [makeFinding('cap:deploy', 5), makeFinding('action_type:migrate', 2)],
    unitCount: 8,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shape tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/posture', () => {
  it('returns 200 with the engine output shape', async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    // Top-level keys
    expect(body).toHaveProperty('score');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('dimensions');
    expect(body).toHaveProperty('findings');
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('snapshotTs');
  });

  it('snapshotTs is null (Task 8 not yet implemented)', async () => {
    const res = await GET(getReq());
    const body = await res.json() as Record<string, unknown>;
    expect(body.snapshotTs).toBeNull();
  });

  it('score and status come from computePosturePayload', async () => {
    const res = await GET(getReq());
    const body = await res.json() as Record<string, unknown>;
    expect(body.score).toBe(78);
    expect(body.status).toBe('needs_attention');
  });

  it('dimensions array has 6 entries (one per dimension)', async () => {
    const res = await GET(getReq());
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.dimensions)).toBe(true);
    expect((body.dimensions as unknown[]).length).toBe(6);
  });

  it('findings are passed through from the engine', async () => {
    const res = await GET(getReq());
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.findings)).toBe(true);
    expect((body.findings as unknown[]).length).toBe(2);
  });

  it('summary.totalUnits equals unitCount from engine', async () => {
    const res = await GET(getReq());
    const body = await res.json() as Record<string, unknown>;
    const summary = body.summary as Record<string, unknown>;
    expect(summary.totalUnits).toBe(8);
  });

  it('summary.openFindings counts findings with status=open', async () => {
    const res = await GET(getReq());
    const body = await res.json() as Record<string, unknown>;
    const summary = body.summary as Record<string, unknown>;
    // Both findings have status='open' in our mock
    expect(summary.openFindings).toBe(2);
  });

  it('summary.pointsRecoverable sums scoreDelta across all findings', async () => {
    const res = await GET(getReq());
    const body = await res.json() as Record<string, unknown>;
    const summary = body.summary as Record<string, unknown>;
    expect(summary.pointsRecoverable).toBe(7); // 5 + 2
  });

  it('passes sql and orgId through to computePosturePayload', async () => {
    await GET(getReq());
    expect(m.computePosturePayload).toHaveBeenCalledOnce();
    const [calledSql, calledOrgId] = m.computePosturePayload.mock.calls[0] as [unknown, string];
    expect(calledSql).toBe(m.sql); // same sql mock reference
    expect(calledOrgId).toBe('org_test');
  });

  it('does NOT call sql directly (all SQL flows through signals.ts)', async () => {
    await GET(getReq());
    // The route must never call sql() itself — that would violate the route-sql guardrail.
    // computePosturePayload is the only thing that touches the DB (via signals/repositories).
    expect(m.sql).not.toHaveBeenCalled();
  });

  it('returns 500 when computePosturePayload throws', async () => {
    m.computePosturePayload.mockRejectedValue(new Error('DB down'));
    const res = await GET(getReq());
    expect(res.status).toBe(500);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('Internal server error');
  });

  it('returns 503 when DATABASE_URL is missing', async () => {
    m.computePosturePayload.mockRejectedValue(new Error('DATABASE_URL is not set'));
    const res = await GET(getReq());
    expect(res.status).toBe(503);
  });
});
