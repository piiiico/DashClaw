import { describe, expect, it, vi } from 'vitest';
import {
  createActionRecord,
  createBlockedActionRecord,
} from '@/lib/repositories/actions.repository.js';

// vi.fn() as tagged-template sql: calls[n][0] is the SQL skeleton, calls[n].slice(1)
// are the interpolated values in column order.
const sqlValues = (call) => call.slice(1);

describe('authoritative risk persistence (R1)', () => {
  it('createActionRecord stores the authoritative riskScore, not the client risk_score', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ action_id: 'act_1', risk_score: 95 }]);
    await createActionRecord(sql, {
      orgId: 'org_1',
      action_id: 'act_1',
      data: { agent_id: 'a1', action_type: 'deploy', declared_goal: 'ship it', risk_score: 5 },
      actionStatus: 'running',
      costEstimate: 0,
      signature: null,
      verified: false,
      timestamp_start: '2026-06-05T00:00:00Z',
      riskScore: 95,
    });
    const vals = sqlValues(sql.mock.calls[0]);
    expect(vals).toContain(95);      // authoritative server score is persisted
    expect(vals).not.toContain(5);   // forgeable client score is NOT persisted
  });

  it('createActionRecord falls back to client risk_score when no authoritative riskScore is supplied', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ action_id: 'act_2' }]);
    await createActionRecord(sql, {
      orgId: 'org_1',
      action_id: 'act_2',
      data: { agent_id: 'a1', action_type: 'read', declared_goal: 'x', risk_score: 12 },
      actionStatus: 'running',
      costEstimate: 0,
      signature: null,
      verified: false,
      timestamp_start: '2026-06-05T00:00:00Z',
      // no riskScore → legacy fallback
    });
    const vals = sqlValues(sql.mock.calls[0]);
    expect(vals).toContain(12);
  });

  it('createBlockedActionRecord stores the authoritative riskScore', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ action_id: 'act_b', status: 'blocked' }]);
    await createBlockedActionRecord(sql, {
      orgId: 'org_1',
      action_id: 'act_b',
      data: { agent_id: 'a1', action_type: 'deploy', declared_goal: 'drop table users', risk_score: 0 },
      guardDecision: { reason: 'blocked', matched_policies: ['p1'], risk_score: 95 },
      signature: null,
      verified: false,
      timestamp_start: '2026-06-05T00:00:00Z',
      riskScore: 95,
    });
    const vals = sqlValues(sql.mock.calls[0]);
    expect(vals).toContain(95);
  });
});
