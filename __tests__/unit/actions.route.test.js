import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockValidateActionRecord,
  mockListActions,
  mockCreateActionRecord,
  mockCreateBlockedActionRecord,
  mockHasAgentAction,
  mockInsertActionEmbedding,
  mockDeleteActionsByIds,
  mockGetActionByIdempotencyKey,
  mockEvaluateGuard,
  mockCheckQuotaFast,
  mockGetOrgPlan,
  mockIncrementMeter,
  mockVerifyAgentSignature,
  mockPublishOrgEvent,
  mockScanSensitiveData,
  mockIsEmbeddingsEnabled,
  mockGenerateActionEmbedding,
  mockEstimateCost,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidateActionRecord: vi.fn(),
  mockListActions: vi.fn(),
  mockCreateActionRecord: vi.fn(),
  mockCreateBlockedActionRecord: vi.fn(),
  mockHasAgentAction: vi.fn(),
  mockInsertActionEmbedding: vi.fn(),
  mockDeleteActionsByIds: vi.fn(),
  mockGetActionByIdempotencyKey: vi.fn(),
  mockEvaluateGuard: vi.fn(),
  mockCheckQuotaFast: vi.fn(),
  mockGetOrgPlan: vi.fn(),
  mockIncrementMeter: vi.fn(),
  mockVerifyAgentSignature: vi.fn(),
  mockPublishOrgEvent: vi.fn(),
  mockScanSensitiveData: vi.fn(),
  mockIsEmbeddingsEnabled: vi.fn(),
  mockGenerateActionEmbedding: vi.fn(),
  mockEstimateCost: vi.fn(),
}));

// next/server's `after()` throws "outside a request scope" in unit tests.
// Mock it to a pass-through that invokes the callback immediately.
vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server');
  return { ...actual, after: (cb) => { try { cb(); } catch {} } };
});

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/validate.js', () => ({ validateActionRecord: mockValidateActionRecord }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  listActions: mockListActions,
  createActionRecord: mockCreateActionRecord,
  createBlockedActionRecord: mockCreateBlockedActionRecord,
  deleteActionsByIds: mockDeleteActionsByIds,
  hasAgentAction: mockHasAgentAction,
  insertActionEmbedding: mockInsertActionEmbedding,
  getActionByIdempotencyKey: mockGetActionByIdempotencyKey,
}));
vi.mock('@/lib/guard.js', () => ({ evaluateGuard: mockEvaluateGuard }));
vi.mock('@/lib/usage.js', () => ({
  checkQuotaFast: mockCheckQuotaFast,
  getOrgPlan: mockGetOrgPlan,
  incrementMeter: mockIncrementMeter,
}));
vi.mock('@/lib/identity.js', () => ({ verifyAgentSignature: mockVerifyAgentSignature }));
vi.mock('@/lib/events.js', () => ({
  EVENTS: { ACTION_CREATED: 'action.created', ACTION_UPDATED: 'action.updated' },
  publishOrgEvent: mockPublishOrgEvent,
}));
vi.mock('@/lib/security.js', () => ({
  scanSensitiveData: mockScanSensitiveData,
  redactAny: function redactAny(value, findings) {
    if (typeof value === 'string') {
      const scan = mockScanSensitiveData(value);
      if (!scan.clean) findings.push(...scan.findings);
      return scan.redacted;
    }
    if (Array.isArray(value)) return value.map((v) => redactAny(v, findings));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = redactAny(v, findings);
      return out;
    }
    return value;
  },
}));
vi.mock('@/lib/embeddings.js', () => ({
  isEmbeddingsEnabled: mockIsEmbeddingsEnabled,
  generateActionEmbedding: mockGenerateActionEmbedding,
}));
vi.mock('@/lib/billing.js', () => ({ estimateCost: mockEstimateCost }));

import { GET, POST, DELETE } from '@/api/actions/route.js';

const defaultGuardDecision = { decision: 'allow', reasons: [], warnings: [], matched_policies: [] };
const defaultQuota = { allowed: true, usage: 0, limit: 1000, percent: 0 };
const defaultAction = { action_id: 'act_test', agent_id: 'agent_1', action_type: 'build', declared_goal: 'Test' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = 'postgres://unit-test';
  process.env.NODE_ENV = 'test';
  delete process.env.ENFORCE_AGENT_SIGNATURES;
  delete process.env.DASHCLAW_CLOSED_ENROLLMENT;

  mockSql.mockImplementation(async () => []);
  mockSql.query.mockImplementation(async () => []);
  mockEvaluateGuard.mockResolvedValue(defaultGuardDecision);
  mockCheckQuotaFast.mockResolvedValue(defaultQuota);
  mockGetOrgPlan.mockResolvedValue('free');
  mockIncrementMeter.mockResolvedValue(undefined);
  mockHasAgentAction.mockResolvedValue(true);
  mockScanSensitiveData.mockReturnValue({ clean: true, redacted: undefined, findings: [] });
  mockIsEmbeddingsEnabled.mockReturnValue(false);
  mockPublishOrgEvent.mockResolvedValue(undefined);
  mockEstimateCost.mockReturnValue(0);
});

describe('/api/actions GET', () => {
  it('returns actions with pagination defaults', async () => {
    mockListActions.mockResolvedValue({ actions: [defaultAction], total: 1, stats: {} });

    const res = await GET(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.actions).toHaveLength(1);
    expect(data.total).toBe(1);
  });

  it('passes filters to listActions', async () => {
    mockListActions.mockResolvedValue({ actions: [], total: 0, stats: {} });

    await GET(makeRequest('http://localhost/api/actions?agent_id=a1&status=running&action_type=build&risk_min=50', {
      headers: { 'x-org-id': 'org_1' },
    }));

    expect(mockListActions).toHaveBeenCalledWith(
      mockSql,
      'org_1',
      expect.objectContaining({
        agent_id: 'a1',
        status: 'running',
        action_type: 'build',
        risk_min: '50',
      })
    );
  });

  it('caps limit at 200', async () => {
    mockListActions.mockResolvedValue({ actions: [], total: 0, stats: {} });

    await GET(makeRequest('http://localhost/api/actions?limit=9999', {
      headers: { 'x-org-id': 'org_1' },
    }));

    const call = mockListActions.mock.calls[0][2];
    expect(call.limit).toBe(200);
  });

  it('returns 500 on repository error', async () => {
    mockListActions.mockRejectedValue(new Error('db down'));

    const res = await GET(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
    }));

    expect(res.status).toBe(500);
  });
});

describe('/api/actions POST', () => {
  const validBody = {
    agent_id: 'agent_1',
    action_type: 'build',
    declared_goal: 'Build the project',
  };

  beforeEach(() => {
    mockValidateActionRecord.mockReturnValue({ valid: true, data: { ...validBody }, errors: [] });
    mockCreateActionRecord.mockResolvedValue({ ...validBody, action_id: 'act_new' });
    mockScanSensitiveData.mockImplementation((val) => ({ clean: true, redacted: val, findings: [] }));
  });

  it('returns 201 for a valid action with allow decision', async () => {
    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.action_id).toBeDefined();
    expect(data.decision.decision).toBe('allow');
  });

  it('returns 400 on validation failure', async () => {
    mockValidateActionRecord.mockReturnValue({
      valid: false,
      data: {},
      errors: ['agent_id is required', 'action_type is required'],
    });

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: {},
    }));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details).toContain('agent_id is required');
  });

  it('returns 402 when actions quota is exceeded', async () => {
    mockCheckQuotaFast.mockResolvedValue({ allowed: false, usage: 1000, limit: 1000, percent: 100 });

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.code).toBe('QUOTA_EXCEEDED');
  });

  it('returns 403 when guard blocks the action and creates blocked action record', async () => {
    mockEvaluateGuard.mockResolvedValue({
      decision: 'block',
      reasons: ['Policy violation'],
      warnings: [],
      matched_policies: ['gp_1'],
    });
    mockCreateBlockedActionRecord.mockResolvedValue({ ...validBody, action_id: 'act_blocked', status: 'blocked' });

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.decision.decision).toBe('block');
    expect(data.action).toBeDefined();
    expect(data.action.status).toBe('blocked');
    expect(mockCreateBlockedActionRecord).toHaveBeenCalled();
  });

  it('returns 202 when guard requires approval', async () => {
    mockEvaluateGuard.mockResolvedValue({
      decision: 'require_approval',
      reasons: ['High risk action'],
      warnings: [],
      matched_policies: ['gp_2'],
    });
    mockCreateActionRecord.mockResolvedValue({ ...validBody, action_id: 'act_new', status: 'pending_approval' });

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(202);
  });

  it('returns 403 when closed enrollment blocks unknown agent', async () => {
    process.env.DASHCLAW_CLOSED_ENROLLMENT = 'true';
    mockHasAgentAction.mockResolvedValue(false);

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('AGENT_NOT_REGISTERED');
  });

  it('returns 402 when agent quota is exceeded for a new agent', async () => {
    mockHasAgentAction.mockResolvedValue(false);
    mockCheckQuotaFast
      .mockResolvedValueOnce(defaultQuota) // actions quota passes
      .mockResolvedValueOnce({ allowed: false, usage: 5, limit: 5, percent: 100 }); // agents quota fails

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(402);
  });

  it('returns 401 when signature enforcement is opted in but signature is missing', async () => {
    process.env.ENFORCE_AGENT_SIGNATURES = 'true';

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe('SIGNATURE_REQUIRED');

    delete process.env.ENFORCE_AGENT_SIGNATURES;
  });

  it('includes DLP findings in security metadata', async () => {
    const findings = [{ category: 'api_key', severity: 'critical', field: 'declared_goal' }];
    mockScanSensitiveData.mockReturnValue({ clean: false, redacted: '[REDACTED]', findings });

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.security.clean).toBe(false);
    expect(data.security.critical_count).toBe(1);
  });

  it('sets quota warning header when near limit', async () => {
    mockCheckQuotaFast.mockResolvedValue({ allowed: true, usage: 900, limit: 1000, percent: 90, warning: true });

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.headers.get('x-quota-warning')).toContain('actions_per_month');
  });

  it('returns 409 on duplicate action_id', async () => {
    mockCreateActionRecord.mockRejectedValue(new Error('unique constraint violated'));

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(409);
  });

  it('returns 500 on unexpected error', async () => {
    mockCreateActionRecord.mockRejectedValue(new Error('database unavailable'));

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(500);
  });

  // --- Durable execution finality — Phase 6 idempotency ---

  describe('idempotency_key short-circuit', () => {
    it('returns the existing row when idempotency_key already exists for this org', async () => {
      const existingRow = {
        action_id: 'act_prev',
        agent_id: 'agent_1',
        action_type: 'build',
        declared_goal: 'Build the project',
        idempotency_key: 'k1',
      };
      mockValidateActionRecord.mockReturnValue({
        valid: true,
        data: { ...validBody, idempotency_key: 'k1' },
        errors: [],
      });
      mockGetActionByIdempotencyKey.mockResolvedValue(existingRow);

      const res = await POST(makeRequest('http://localhost/api/actions', {
        headers: { 'x-org-id': 'org_1' },
        body: { ...validBody, idempotency_key: 'k1' },
      }));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.idempotent_replay).toBe(true);
      expect(data.action.action_id).toBe('act_prev');

      // Critical: nothing downstream runs on a replay — no quota, no guard,
      // no create, no signature verification.
      expect(mockCheckQuotaFast).not.toHaveBeenCalled();
      expect(mockEvaluateGuard).not.toHaveBeenCalled();
      expect(mockCreateActionRecord).not.toHaveBeenCalled();
    });

    it('proceeds normally when idempotency_key is supplied but no prior row exists', async () => {
      mockValidateActionRecord.mockReturnValue({
        valid: true,
        data: { ...validBody, idempotency_key: 'k_new' },
        errors: [],
      });
      mockGetActionByIdempotencyKey.mockResolvedValue(null);

      const res = await POST(makeRequest('http://localhost/api/actions', {
        headers: { 'x-org-id': 'org_1' },
        body: { ...validBody, idempotency_key: 'k_new' },
      }));

      expect(res.status).toBe(201);
      expect(mockCreateActionRecord).toHaveBeenCalledTimes(1);
    });

    it('does not call the idempotency lookup when no key is supplied', async () => {
      mockValidateActionRecord.mockReturnValue({
        valid: true,
        data: { ...validBody },
        errors: [],
      });

      const res = await POST(makeRequest('http://localhost/api/actions', {
        headers: { 'x-org-id': 'org_1' },
        body: validBody,
      }));

      expect(res.status).toBe(201);
      expect(mockGetActionByIdempotencyKey).not.toHaveBeenCalled();
    });
  });
});

describe('/api/actions DELETE', () => {
  it('returns 403 for non-admins', async () => {
    const res = await DELETE(makeRequest('http://localhost/api/actions?action_id=act_1', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'member' },
    }));

    expect(res.status).toBe(403);
  });

  it('deletes a single action by action_id', async () => {
    mockDeleteActionsByIds.mockResolvedValue([{ action_id: 'act_1' }]);

    const res = await DELETE(makeRequest('http://localhost/api/actions?action_id=act_1', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(1);
  });

  it('returns 400 on bulk delete with no filters', async () => {
    const res = await DELETE(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(400);
  });

  it('performs bulk delete with before filter', async () => {
    mockSql.query.mockResolvedValue([{ action_id: 'act_1' }, { action_id: 'act_2' }]);

    const res = await DELETE(makeRequest('http://localhost/api/actions?before=2026-01-01', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(2);
  });

  it('returns 500 on error', async () => {
    mockDeleteActionsByIds.mockRejectedValue(new Error('db error'));

    const res = await DELETE(makeRequest('http://localhost/api/actions?action_id=act_1', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(500);
  });
});
