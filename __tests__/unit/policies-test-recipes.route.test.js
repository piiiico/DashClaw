import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

// Recipe mode exercises the REAL enforcement evaluator (app/lib/guard.js
// evaluatePolicy), so guard.js is intentionally NOT mocked. block_action_type
// and risk_threshold are pure (no SQL), so a mock sql client is enough.
const { mockSql } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));

import { POST } from '@/api/policies/test/route.js';

describe('/api/policies/test POST recipe mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
  });

  it('runs inline recipes through the real evaluator; an expecting-block recipe passes when the rule blocks and fails when it does not', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/test', {
        headers: { 'x-org-id': 'org_1' },
        body: {
          policy_type: 'block_action_type',
          rules: { action_types: ['deploy'], action: 'block' },
          tests: [
            { name: 'blocks deploy', input: { action_type: 'deploy' }, expect: { decision: 'block' } },
            { name: 'wrongly expects block for test', input: { action_type: 'test' }, expect: { decision: 'block' } },
          ],
        },
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe('recipe');
    expect(data.results.total_tests).toBe(2);
    expect(data.results.passed).toBe(1);
    expect(data.results.success).toBe(false);

    const tests = data.results.details[0].tests;
    expect(tests[0].passed).toBe(true);
    expect(tests[0].actual).toBe('block');
    expect(tests[1].passed).toBe(false);
    expect(tests[1].actual).toBe('allow');
  });

  it('reads recipes from rules.tests when body.tests is absent (risk_threshold)', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/test', {
        headers: { 'x-org-id': 'org_1' },
        body: {
          policy_type: 'risk_threshold',
          rules: {
            threshold: 70,
            action: 'block',
            tests: [
              { name: 'high risk blocks', input: { risk_score: 90 }, expect: { decision: 'block' } },
              { name: 'low risk allows', input: { risk_score: 10 }, expect: { decision: 'allow' } },
            ],
          },
        },
      }),
    );

    const data = await res.json();
    expect(data.results.total_tests).toBe(2);
    expect(data.results.passed).toBe(2);
    expect(data.results.success).toBe(true);
  });

  it('accepts rules as a JSON string', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/test', {
        headers: { 'x-org-id': 'org_1' },
        body: {
          policy_type: 'block_action_type',
          rules: JSON.stringify({ action_types: ['deploy'], action: 'block' }),
          tests: [{ name: 'blocks deploy', input: { action_type: 'deploy' }, expect: { decision: 'block' } }],
        },
      }),
    );

    const data = await res.json();
    expect(data.mode).toBe('recipe');
    expect(data.results.passed).toBe(1);
  });

  it('returns 400 when rules is an unparseable JSON string', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/test', {
        headers: { 'x-org-id': 'org_1' },
        body: { policy_type: 'block_action_type', rules: '{not json' },
      }),
    );
    expect(res.status).toBe(400);
  });
});
