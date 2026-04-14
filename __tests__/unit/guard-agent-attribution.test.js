/**
 * Phase 1 agent attribution tests.
 *
 * Verifies that the guard route correctly extracts agentId / agentName from:
 *  1. Explicit body fields (trust-on-assertion baseline)
 *  2. A JWT Authorization header (decoded, not verified in Phase 1)
 *  3. Combination: body fields take precedence over JWT claims
 * Also verifies graceful handling of malformed or absent tokens.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockValidateGuardInput, mockEvaluateGuard, mockListGuardDecisions } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidateGuardInput: vi.fn(),
  mockEvaluateGuard: vi.fn(),
  mockListGuardDecisions: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/validate', () => ({ validateGuardInput: mockValidateGuardInput }));
vi.mock('@/lib/guard', () => ({ evaluateGuard: mockEvaluateGuard }));
vi.mock('@/lib/repositories/guard.repository.js', () => ({ listGuardDecisions: mockListGuardDecisions }));

import { POST } from '@/api/guard/route.js';

// JWT with sub=agt_test123 and agent_name=test-worker (signature is fake — Phase 1 doesn't verify)
const TEST_JWT = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZ3RfdGVzdDEyMyIsImFnZW50X25hbWUiOiJ0ZXN0LXdvcmtlciIsImlzcyI6Imh0dHBzOi8vYWdlbnRsYWlyLmRldiIsImV4cCI6OTk5OTk5OTk5OX0.fakesig';

describe('/api/guard — Phase 1 agent attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    process.env.DASHCLAW_MODE = 'cloud';
    mockSql.mockImplementation(async () => []);
    mockSql.query.mockImplementation(async () => []);
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [], warnings: [], matched_policies: [] });
  });

  it('passes agent_id and agent_name from request body to evaluateGuard', async () => {
    mockValidateGuardInput.mockImplementation((body) => ({
      valid: true,
      data: body,
      errors: [],
    }));

    await POST(makeRequest('http://localhost/api/guard', {
      headers: { 'x-org-id': 'org_1' },
      body: { action_type: 'deploy', agent_id: 'agt_body_id', agent_name: 'body-worker' },
    }));

    expect(mockEvaluateGuard).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ agent_id: 'agt_body_id', agent_name: 'body-worker' }),
      mockSql,
      expect.any(Object)
    );
  });

  it('extracts agent_id and agent_name from JWT Authorization header', async () => {
    mockValidateGuardInput.mockImplementation((body) => ({
      valid: true,
      data: body,
      errors: [],
    }));

    await POST(makeRequest('http://localhost/api/guard', {
      headers: {
        'x-org-id': 'org_1',
        'authorization': `Bearer ${TEST_JWT}`,
      },
      body: { action_type: 'deploy' },
    }));

    expect(mockValidateGuardInput).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'agt_test123', agent_name: 'test-worker' })
    );
  });

  it('body agent_id and agent_name take precedence over JWT claims', async () => {
    mockValidateGuardInput.mockImplementation((body) => ({
      valid: true,
      data: body,
      errors: [],
    }));

    await POST(makeRequest('http://localhost/api/guard', {
      headers: {
        'x-org-id': 'org_1',
        'authorization': `Bearer ${TEST_JWT}`,
      },
      body: { action_type: 'deploy', agent_id: 'agt_explicit', agent_name: 'explicit-worker' },
    }));

    expect(mockValidateGuardInput).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'agt_explicit', agent_name: 'explicit-worker' })
    );
  });

  it('ignores malformed JWT and falls through to body values', async () => {
    mockValidateGuardInput.mockImplementation((body) => ({
      valid: true,
      data: body,
      errors: [],
    }));

    await POST(makeRequest('http://localhost/api/guard', {
      headers: {
        'x-org-id': 'org_1',
        'authorization': 'Bearer not.a.valid-jwt-at-all',
      },
      body: { action_type: 'deploy', agent_id: 'agt_fallback' },
    }));

    // Should not throw; agent_id from body should still be passed
    expect(mockValidateGuardInput).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'agt_fallback' })
    );
    expect(mockEvaluateGuard).toHaveBeenCalled();
  });

  it('proceeds normally when no Authorization header is present', async () => {
    mockValidateGuardInput.mockImplementation((body) => ({
      valid: true,
      data: body,
      errors: [],
    }));

    const res = await POST(makeRequest('http://localhost/api/guard', {
      headers: { 'x-org-id': 'org_1' },
      body: { action_type: 'read' },
    }));

    expect(res.status).toBe(200);
    expect(mockEvaluateGuard).toHaveBeenCalled();
  });
});
