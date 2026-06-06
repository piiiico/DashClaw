import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostureFinding } from '../../app/lib/posture/types';

/**
 * Tests for POST /api/posture/findings/[key]/resolve.
 *
 * The crown-jewel assertions are the HONESTY PROPERTY ones: create_draft must
 * insert an INACTIVE policy (active=0) and mark the finding `drafted` (never
 * `resolved`), so drafting can never raise the score.
 */

const m = vi.hoisted(() => ({
  sql: vi.fn(async () => []),
  computePosturePayload: vi.fn(),
  setFindingState: vi.fn(async () => ({ findingKey: 'k', status: 'drafted', note: null, actor: null, createdAt: 't', updatedAt: 't' })),
  insertPolicy: vi.fn(async () => ({ id: 'gp_x', active: 0 })),
  validatePolicy: vi.fn((): { valid: boolean; errors: string[] } => ({ valid: true, errors: [] })),
  publishOrgEvent: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => m.sql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test', getUserId: () => 'usr_1' }));
vi.mock('@/lib/posture/signals.js', () => ({ computePosturePayload: m.computePosturePayload }));
vi.mock('@/lib/repositories/posture.repository.js', () => ({ setFindingState: m.setFindingState }));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({ insertPolicy: m.insertPolicy }));
vi.mock('@/lib/validate.js', () => ({ validatePolicy: m.validatePolicy }));
vi.mock('@/lib/events.js', () => ({ EVENTS: { POLICY_UPDATED: 'policy.updated' }, publishOrgEvent: m.publishOrgEvent }));

const { POST } = await import('@/api/posture/findings/[key]/resolve/route.js');

function draftFinding(key: string): PostureFinding {
  return {
    key,
    dimension: 'enforcement',
    severity: 'critical',
    title: 'Destructive deploy actions reach allow ungoverned',
    evidence: { observedCount: 38, exampleActionIds: ['act_1'] },
    scoreDelta: 6,
    fix: { type: 'create_policy_draft', policyType: 'risk_threshold', rules: { threshold: 50, action: 'require_approval' } },
    status: 'open',
  };
}

function ctx(key: string) {
  return { params: Promise.resolve({ key }) };
}

function postReq(action: string, note?: string): Request {
  return new Request('http://localhost/api/posture/findings/k1/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, note }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.computePosturePayload.mockResolvedValue({
    score: { score: 70, status: 'needs_attention', cappedBy: null, dimensions: [] },
    findings: [draftFinding('k1')],
    unitCount: 1,
  });
  m.validatePolicy.mockReturnValue({ valid: true, errors: [] });
  m.insertPolicy.mockResolvedValue({ id: 'gp_x', active: 0 });
});

describe('POST resolve — create_draft (honesty property)', () => {
  it('inserts an INACTIVE policy (active=0) — never enables enforcement', async () => {
    const res = await POST(postReq('create_draft'), ctx('k1'));
    expect(res.status).toBe(200);
    expect(m.insertPolicy).toHaveBeenCalledOnce();
    const insertArg = (m.insertPolicy.mock.calls as unknown as unknown[][])[0]![2] as { active: number };
    expect(insertArg.active).toBe(0);
  });

  it('marks the finding `drafted`, NOT `resolved`', async () => {
    await POST(postReq('create_draft'), ctx('k1'));
    expect(m.setFindingState).toHaveBeenCalledOnce();
    const [, , key, status] = (m.setFindingState.mock.calls as unknown as unknown[][])[0]!;
    expect(key).toBe('k1');
    expect(status).toBe('drafted');
    expect(status).not.toBe('resolved');
  });

  it('returns the drafted finding + an honesty note', async () => {
    const res = await POST(postReq('create_draft'), ctx('k1'));
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('drafted');
    expect((body.finding as PostureFinding).status).toBe('drafted');
    expect(String(body.note)).toMatch(/does not raise the posture score/i);
  });

  it('404s when the finding key does not exist', async () => {
    const res = await POST(postReq('create_draft'), ctx('missing'));
    expect(res.status).toBe(404);
    expect(m.insertPolicy).not.toHaveBeenCalled();
  });

  it('400s when the policy draft fails validation (does not insert)', async () => {
    m.validatePolicy.mockReturnValue({ valid: false, errors: ['bad rules'] });
    const res = await POST(postReq('create_draft'), ctx('k1'));
    expect(res.status).toBe(400);
    expect(m.insertPolicy).not.toHaveBeenCalled();
    expect(m.setFindingState).not.toHaveBeenCalled();
  });

  it('400s when the finding fix is not a create_policy_draft (e.g. review_incident)', async () => {
    m.computePosturePayload.mockResolvedValue({
      score: { score: 50, status: 'at_risk', cappedBy: 'incident', dimensions: [] },
      findings: [{ ...draftFinding('k1'), fix: { type: 'review_incident', actionIds: ['act_1'], deepLink: '/decisions/act_1' } }],
      unitCount: 1,
    });
    const res = await POST(postReq('create_draft'), ctx('k1'));
    expect(res.status).toBe(400);
    expect(m.insertPolicy).not.toHaveBeenCalled();
  });
});

describe('POST resolve — snooze / accept_risk', () => {
  it('snooze records status `snoozed` without touching policies', async () => {
    await POST(postReq('snooze', 'later'), ctx('k1'));
    expect(m.insertPolicy).not.toHaveBeenCalled();
    const [, , , status, actor, note] = (m.setFindingState.mock.calls as unknown as unknown[][])[0]!;
    expect(status).toBe('snoozed');
    expect(actor).toBe('usr_1');
    expect(note).toBe('later');
  });

  it('accept_risk records status `accepted_risk` without touching policies', async () => {
    await POST(postReq('accept_risk'), ctx('k1'));
    expect(m.insertPolicy).not.toHaveBeenCalled();
    const [, , , status] = (m.setFindingState.mock.calls as unknown as unknown[][])[0]!;
    expect(status).toBe('accepted_risk');
  });

  it('does NOT recompute the score for a pure state record (no computePosturePayload call)', async () => {
    await POST(postReq('snooze'), ctx('k1'));
    expect(m.computePosturePayload).not.toHaveBeenCalled();
  });
});

describe('POST resolve — validation', () => {
  it('400s on an invalid action', async () => {
    const res = await POST(postReq('delete_everything'), ctx('k1'));
    expect(res.status).toBe(400);
  });

  it('400s on a missing action', async () => {
    const res = await POST(
      new Request('http://localhost/api/posture/findings/k1/resolve', { method: 'POST', body: '{}' }),
      ctx('k1'),
    );
    expect(res.status).toBe(400);
  });
});
