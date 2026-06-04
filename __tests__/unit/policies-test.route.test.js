import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockGetActivePolicies, mockConvertPolicies, mockEvaluatePolicy, mockCreateTestRun } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetActivePolicies: vi.fn(),
  mockConvertPolicies: vi.fn(),
  mockEvaluatePolicy: vi.fn(),
  mockCreateTestRun: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  getActivePolicies: mockGetActivePolicies,
  createTestRun: mockCreateTestRun,
}));
vi.mock('@/lib/guardrails/converter.js', () => ({ convertPolicies: mockConvertPolicies }));
vi.mock('@/lib/guardrails/evaluator.js', () => ({ evaluateGuardrailPolicy: mockEvaluatePolicy }));

import { POST } from '@/api/policies/test/route.js';

describe('/api/policies/test POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
  });

  it('returns empty results when no policies', async () => {
    mockGetActivePolicies.mockResolvedValue([]);
    const res = await POST(makeRequest('http://localhost/api/policies/test', { headers: { 'x-org-id': 'org_1' }, body: {} }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.total_policies).toBe(0);
  });

  it('runs tests and returns results', async () => {
    mockGetActivePolicies.mockResolvedValue([{ id: 'gp_1', name: 'P1', policy_type: 'block_action_type', rules: '{}', active: 1 }]);
    mockConvertPolicies.mockReturnValue({
      version: 1,
      project: 'test',
      policies: [{
        id: 'gp_1',
        description: 'P1',
        applies_to: { tools: ['delete'] },
        rule: { block: true },
        tests: [{ name: 'blocks_delete', input: { tool: 'delete' }, expect: { allowed: false } }],
      }],
    });
    mockEvaluatePolicy.mockReturnValue({ allowed: false, policy_id: 'gp_1', reason: 'blocked' });
    mockCreateTestRun.mockResolvedValue({});

    const res = await POST(makeRequest('http://localhost/api/policies/test', { headers: { 'x-org-id': 'org_1' }, body: {} }));
    const data = await res.json();
    expect(data.results.total_tests).toBe(1);
    expect(data.results.passed).toBe(1);
    expect(data.results.success).toBe(true);
  });

  it('stores test run results', async () => {
    mockGetActivePolicies.mockResolvedValue([{ id: 'gp_1', active: 1 }]);
    mockConvertPolicies.mockReturnValue({ version: 1, project: 'test', policies: [{ id: 'gp_1', description: 'P', tests: [] }] });
    mockCreateTestRun.mockResolvedValue({});

    await POST(makeRequest('http://localhost/api/policies/test', { headers: { 'x-org-id': 'org_1' }, body: {} }));
    expect(mockCreateTestRun).toHaveBeenCalledWith(mockSql, 'org_1', expect.objectContaining({ triggered_by: 'manual' }));
  });

  it('test run ID starts with gtr_', async () => {
    mockGetActivePolicies.mockResolvedValue([{ id: 'gp_1', active: 1 }]);
    mockConvertPolicies.mockReturnValue({ version: 1, project: 'test', policies: [{ id: 'gp_1', description: 'P', tests: [] }] });
    mockCreateTestRun.mockResolvedValue({});

    await POST(makeRequest('http://localhost/api/policies/test', { headers: { 'x-org-id': 'org_1' }, body: {} }));
    expect(mockCreateTestRun.mock.calls[0][2].id).toMatch(/^gtr_/);
  });

  it('returns 500 on error', async () => {
    mockGetActivePolicies.mockRejectedValue(new Error('db fail'));
    const res = await POST(makeRequest('http://localhost/api/policies/test', { headers: { 'x-org-id': 'org_1' }, body: {} }));
    expect(res.status).toBe(500);
  });
});
