import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqlMock } from '../helpers.js';
import {
  gatherEvidenceEvents,
  recomputeReputation,
  listReputationEvents,
  getReputationSnapshot,
} from '../../app/lib/repositories/reputation.repository.js';
import { verifyReputationReceipt } from '../../app/lib/reputation.js';
import { generateSigningKey } from '../../app/lib/integrity/keys.js';
import { _resetSigningKeyCacheForTesting } from '../../app/lib/integrity/server-key.js';

let testKey;

beforeEach(() => {
  testKey = generateSigningKey();
  // Use the env signing key path so getServerSigningKey never touches the DB.
  process.env.DASHCLAW_SIGNING_KEY_JWK = JSON.stringify(testKey.privateKeyJwk);
  _resetSigningKeyCacheForTesting();
});

afterEach(() => {
  delete process.env.DASHCLAW_SIGNING_KEY_JWK;
  _resetSigningKeyCacheForTesting();
});

describe('reputation.repository — evidence sourcing (B4)', () => {
  it('derives outcome/risk/approval/policy_violation/quality events from evidence', async () => {
    const sql = createSqlMock({ taggedResponses: [
      [{ action_id: 'act_1', status: 'completed', outcome_status: 'completed', risk_score: 60, approved_by: 'admin', error_message: null, created_at: '2026-06-01T00:00:00Z' }],
      [{ id: 'gd_1', decision: 'block', created_at: '2026-06-01T00:00:00Z' }, { id: 'gd_2', decision: 'allow', created_at: '2026-06-01T00:00:00Z' }],
      [{ id: 'es_1', score: 0.9, created_at: '2026-06-01T00:00:00Z' }],
      [{ id: 'fb_1', rating: 5, created_at: '2026-06-01T00:00:00Z' }],
    ] });

    const events = await gatherEvidenceEvents(sql, 'org_1', 'agent_1');
    const types = events.map((e) => e.event_type);
    expect(types).toContain('outcome');
    expect(types).toContain('risk');
    expect(types).toContain('approval');
    expect(types.filter((t) => t === 'policy_violation').length).toBe(2);
    expect(types.filter((t) => t === 'quality').length).toBe(2);
    expect(events.find((e) => e.event_type === 'outcome').value).toBe(1);
    expect(events.find((e) => e.event_type === 'risk').value).toBe(60);
  });

  it('scopes every evidence query by org_id and agent_id (no cross-org access)', async () => {
    const sql = createSqlMock();
    await gatherEvidenceEvents(sql, 'org_42', 'agent_x');
    expect(sql.taggedCalls.length).toBe(4);
    for (const call of sql.taggedCalls) {
      expect(call.values).toContain('org_42');
      expect(call.values).toContain('agent_x');
    }
  });
});

describe('reputation.repository — recompute + receipt (contract style, B5)', () => {
  it('seeds an action+outcome, recomputes, returns a vector and a verifiable receipt', async () => {
    const sql = createSqlMock({ taggedResponses: [
      [{ action_id: 'act_1', status: 'completed', outcome_status: 'completed', risk_score: 40, approved_by: null, error_message: null, created_at: '2026-06-01T00:00:00Z' }],
      [], // guard
      [], // evals
      [], // feedback
    ] });

    const { vector, receipt } = await recomputeReputation(sql, 'org_1', 'agent_1', { now: '2026-06-04T00:00:00Z' });

    expect(vector.agent_id).toBe('agent_1');
    expect(vector.completion_rate).toBeGreaterThan(0.7); // one success lifts above the prior
    expect(vector.risk_score).toBe(40);
    expect(vector.total_events).toBe(2); // outcome + risk

    expect(verifyReputationReceipt(receipt, testKey.publicKeyJwk)).toEqual({ ok: true });
  });
});

describe('reputation.repository — org scoping of reads', () => {
  it('listReputationEvents and getReputationSnapshot filter by org_id + agent_id', async () => {
    const sql = createSqlMock();
    await listReputationEvents(sql, 'org_9', 'agent_9', { limit: 10 });
    await getReputationSnapshot(sql, 'org_9', 'agent_9');
    for (const call of sql.taggedCalls) {
      expect(call.values).toContain('org_9');
      expect(call.values).toContain('agent_9');
    }
  });
});
