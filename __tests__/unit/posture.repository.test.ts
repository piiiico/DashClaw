import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCapabilityUnits,
  getObservedActionUnits,
  getRecentDecisions,
  getIdentityBoundAgents,
  getX402SpendSurfaces,
} from '../../app/lib/repositories/posture.repository';
import type { SqlTag } from '../../app/lib/types/db';

// ─────────────────────────────────────────────────────────────────────────────
// SQL mock — mirrors capabilities.repository.test.js harness
// ─────────────────────────────────────────────────────────────────────────────

function makeSqlMock(responses: Record<string, unknown>[][]) {
  const queue = [...responses];
  const calls: { strings: TemplateStringsArray; values: unknown[] }[] = [];
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings, values });
    return Promise.resolve(queue.shift() ?? []);
  }) as unknown as SqlTag & { calls: typeof calls };
  (fn as unknown as { calls: typeof calls }).calls = calls;
  return fn;
}

beforeEach(() => vi.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// getCapabilityUnits
// ─────────────────────────────────────────────────────────────────────────────

describe('getCapabilityUnits', () => {
  it('maps a capability row to a GovernableUnit with surfaceType=capability', async () => {
    const sql = makeSqlMock([[{
      slug: 'send-slack',
      name: 'Send Slack',
      category: 'messaging',
      source_type: 'http_api',
      risk_level: 'medium',
      requires_approval: 0,
      pricing_json: '{}',
    }]]);
    const units = await getCapabilityUnits(sql, 'org_1');
    expect(units).toHaveLength(1);
    expect(units[0]!.key).toBe('send-slack');
    expect(units[0]!.surfaceType).toBe('capability');
    expect(units[0]!.riskLevel).toBe('medium');
    expect(units[0]!.requiresApproval).toBe(false);
    expect(units[0]!.hasSpendExposure).toBe(false);
    expect(units[0]!.observedCount).toBe(0);
  });

  it('sets hasSpendExposure=true when pricing_json is non-empty', async () => {
    const sql = makeSqlMock([[{
      slug: 'paid-api',
      name: 'Paid API',
      category: 'data',
      source_type: 'http_api',
      risk_level: 'high',
      requires_approval: 0,
      pricing_json: '{"per_call": 0.01}',
    }]]);
    const units = await getCapabilityUnits(sql, 'org_1');
    expect(units[0]!.hasSpendExposure).toBe(true);
  });

  it('sets hasSpendExposure=true when source_type is external_marketplace', async () => {
    const sql = makeSqlMock([[{
      slug: 'marketplace-cap',
      name: 'Marketplace Cap',
      category: 'tools',
      source_type: 'external_marketplace',
      risk_level: 'low',
      requires_approval: 0,
      pricing_json: '{}',
    }]]);
    const units = await getCapabilityUnits(sql, 'org_1');
    expect(units[0]!.hasSpendExposure).toBe(true);
  });

  it('normalizes requires_approval from integer 1', async () => {
    const sql = makeSqlMock([[{
      slug: 'guarded',
      name: 'Guarded',
      category: 'security',
      source_type: 'internal_sdk',
      risk_level: 'critical',
      requires_approval: 1,
      pricing_json: null,
    }]]);
    const units = await getCapabilityUnits(sql, 'org_1');
    expect(units[0]!.requiresApproval).toBe(true);
    expect(units[0]!.riskLevel).toBe('critical');
  });

  it('falls back to medium risk for unrecognized risk_level', async () => {
    const sql = makeSqlMock([[{
      slug: 'unknown-risk',
      name: 'Unknown',
      category: null,
      source_type: 'internal_sdk',
      risk_level: 'banana',
      requires_approval: 0,
      pricing_json: null,
    }]]);
    const units = await getCapabilityUnits(sql, 'org_1');
    expect(units[0]!.riskLevel).toBe('medium');
  });

  it('passes orgId as interpolated value', async () => {
    const sql = makeSqlMock([[]]);
    await getCapabilityUnits(sql, 'org_test');
    const mock = sql as unknown as { calls: { values: unknown[] }[] };
    expect(mock.calls[0]!.values).toContain('org_test');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getObservedActionUnits
// ─────────────────────────────────────────────────────────────────────────────

describe('getObservedActionUnits', () => {
  it('maps an action_records aggregate to a GovernableUnit with surfaceType=action_type', async () => {
    const sql = makeSqlMock([[{
      action_type: 'deploy',
      risk_score_avg: 72,
      observed_count: 5,
      reversible_any: 1,
      systems_touched_sample: null,
      has_cost: 0,
    }]]);
    const units = await getObservedActionUnits(sql, 'org_1');
    expect(units).toHaveLength(1);
    expect(units[0]!.key).toBe('action_type:deploy');
    expect(units[0]!.surfaceType).toBe('action_type');
    expect(units[0]!.riskLevel).toBe('high'); // 72 → high (50-75)
    expect(units[0]!.reversible).toBe(false); // reversible_any=1 → NOT reversible
    expect(units[0]!.observedCount).toBe(5);
  });

  it('sets hasSpendExposure=true when has_cost=1', async () => {
    const sql = makeSqlMock([[{
      action_type: 'api',
      risk_score_avg: 30,
      observed_count: 10,
      reversible_any: 0,
      systems_touched_sample: null,
      has_cost: 1,
    }]]);
    const units = await getObservedActionUnits(sql, 'org_1');
    expect(units[0]!.hasSpendExposure).toBe(true);
  });

  it('buckets risk scores: 0-24=low, 25-49=medium, 50-74=high, 75+=critical', async () => {
    const cases: [number, string][] = [
      [10, 'low'], [35, 'medium'], [60, 'high'], [80, 'critical'],
    ];
    for (const [score, expected] of cases) {
      const sql = makeSqlMock([[{
        action_type: 'test',
        risk_score_avg: score,
        observed_count: 1,
        reversible_any: 0,
        systems_touched_sample: null,
        has_cost: 0,
      }]]);
      const units = await getObservedActionUnits(sql, 'org_1');
      expect(units[0]!.riskLevel).toBe(expected);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getRecentDecisions
// ─────────────────────────────────────────────────────────────────────────────

describe('getRecentDecisions', () => {
  it('returns decision rows as-is', async () => {
    const row = {
      action_id: 'act_abc',
      risk_score: 75,
      action_type: 'deploy',
      outcome_status: 'completed',
      created_at: '2026-06-01T00:00:00Z',
    };
    const sql = makeSqlMock([[row]]);
    const rows = await getRecentDecisions(sql, 'org_1', '2026-05-25T00:00:00Z');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action_id).toBe('act_abc');
  });

  it('passes orgId and sinceTs as interpolated values', async () => {
    const sql = makeSqlMock([[]]);
    const ts = '2026-06-01T00:00:00Z';
    await getRecentDecisions(sql, 'org_xyz', ts);
    const mock = sql as unknown as { calls: { values: unknown[] }[] };
    expect(mock.calls[0]!.values).toContain('org_xyz');
    expect(mock.calls[0]!.values).toContain(ts);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getIdentityBoundAgents
// ─────────────────────────────────────────────────────────────────────────────

describe('getIdentityBoundAgents', () => {
  it('returns agent rows', async () => {
    const sql = makeSqlMock([[{ agent_id: 'agent_abc' }, { agent_id: 'agent_def' }]]);
    const rows = await getIdentityBoundAgents(sql, 'org_1');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.agent_id).toBe('agent_abc');
  });

  it('returns empty array when no bound agents', async () => {
    const sql = makeSqlMock([[]]);
    const rows = await getIdentityBoundAgents(sql, 'org_1');
    expect(rows).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getX402SpendSurfaces
// ─────────────────────────────────────────────────────────────────────────────

describe('getX402SpendSurfaces', () => {
  it('returns active x402 provider rows', async () => {
    const sql = makeSqlMock([[
      { provider_id: 'prov_1', slug: 'openai' },
      { provider_id: 'prov_2', slug: 'stripe' },
    ]]);
    const rows = await getX402SpendSurfaces(sql, 'org_1');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.slug).toBe('openai');
  });

  it('returns empty array when no providers', async () => {
    const sql = makeSqlMock([[]]);
    const rows = await getX402SpendSurfaces(sql, 'org_1');
    expect(rows).toHaveLength(0);
  });
});
