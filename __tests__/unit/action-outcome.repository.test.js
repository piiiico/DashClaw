import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getActionOutcome,
  setActionOutcome,
  sweepLostOutcomesForOrg,
  listOrgsWithStaleOutcomes,
} from '../../app/lib/repositories/actions.repository.js';

// Tagged-template SQL mock — each call shifts the next response off the queue.
function makeSqlMock(responses) {
  const queue = [...responses];
  return vi.fn(() => Promise.resolve(queue.shift() ?? []));
}

describe('getActionOutcome', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when action does not exist', async () => {
    const sql = makeSqlMock([[]]);
    const result = await getActionOutcome(sql, 'org_1', 'act_missing');
    expect(result).toBeNull();
  });

  it('returns shaped outcome with rounded elapsed_ms', async () => {
    const sql = makeSqlMock([[
      {
        action_id: 'act_1',
        outcome_status: 'completed',
        outcome_at: '2026-05-13T00:00:01Z',
        outcome_summary: 'shipped',
        outcome_error: null,
        outcome_progress: null,
        created_at: '2026-05-13T00:00:00Z',
        elapsed_ms: '1234.7',
      },
    ]]);
    const result = await getActionOutcome(sql, 'org_1', 'act_1');
    expect(result).toEqual({
      action_id: 'act_1',
      status: 'completed',
      outcome_at: '2026-05-13T00:00:01Z',
      summary: 'shipped',
      error_message: null,
      progress: null,
      elapsed_ms: 1235,
    });
  });

  it('reports pending state with no outcome_at', async () => {
    const sql = makeSqlMock([[
      {
        action_id: 'act_1',
        outcome_status: 'pending',
        outcome_at: null,
        outcome_summary: null,
        outcome_error: null,
        outcome_progress: null,
        created_at: '2026-05-13T00:00:00Z',
        elapsed_ms: 5000,
      },
    ]]);
    const result = await getActionOutcome(sql, 'org_1', 'act_1');
    expect(result.status).toBe('pending');
    expect(result.elapsed_ms).toBe(5000);
  });
});

describe('setActionOutcome', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an invalid status without hitting the database', async () => {
    const sql = makeSqlMock([]);
    const result = await setActionOutcome(sql, 'org_1', 'act_1', { status: 'banana' });
    expect(result).toEqual({ ok: false, reason: 'invalid_status' });
    expect(sql).not.toHaveBeenCalled();
  });

  it('transitions pending → completed and returns the new outcome', async () => {
    const sql = makeSqlMock([[
      {
        action_id: 'act_1',
        outcome_status: 'completed',
        outcome_at: '2026-05-13T00:00:01Z',
        outcome_summary: 'shipped',
        outcome_error: null,
        outcome_progress: null,
        created_at: '2026-05-13T00:00:00Z',
        elapsed_ms: 1000,
      },
    ]]);
    const result = await setActionOutcome(sql, 'org_1', 'act_1', {
      status: 'completed',
      summary: 'shipped',
    });
    expect(result.ok).toBe(true);
    expect(result.outcome.status).toBe('completed');
    expect(result.outcome.elapsed_ms).toBe(1000);
  });

  it('returns not_found when the action does not exist in this org', async () => {
    // First query (UPDATE...RETURNING) → 0 rows. Second query (existence lookup) → 0 rows.
    const sql = makeSqlMock([[], []]);
    const result = await setActionOutcome(sql, 'org_1', 'act_missing', { status: 'completed' });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns conflict with current_status when outcome is already terminal', async () => {
    // UPDATE gated on outcome_status='pending' returns 0 rows; lookup shows the
    // existing terminal state.
    const sql = makeSqlMock([[], [{ outcome_status: 'failed' }]]);
    const result = await setActionOutcome(sql, 'org_1', 'act_1', { status: 'completed' });
    expect(result).toEqual({ ok: false, reason: 'conflict', current_status: 'failed' });
  });

  it('accepts lost_confirmation (system sweep path)', async () => {
    const sql = makeSqlMock([[
      {
        action_id: 'act_1',
        outcome_status: 'lost_confirmation',
        outcome_at: '2026-05-13T00:15:00Z',
        outcome_summary: 'No outcome reported within timeout window',
        outcome_error: null,
        outcome_progress: null,
        created_at: '2026-05-13T00:00:00Z',
        elapsed_ms: 900000,
      },
    ]]);
    const result = await setActionOutcome(sql, 'org_1', 'act_1', {
      status: 'lost_confirmation',
      summary: 'No outcome reported within timeout window',
    });
    expect(result.ok).toBe(true);
    expect(result.outcome.status).toBe('lost_confirmation');
  });

  it('serializes progress payload as JSON', async () => {
    const sql = makeSqlMock([[
      {
        action_id: 'act_1',
        outcome_status: 'partial',
        outcome_at: '2026-05-13T00:00:01Z',
        outcome_summary: null,
        outcome_error: null,
        outcome_progress: { step: 2, ratio: 0.5 },
        created_at: '2026-05-13T00:00:00Z',
        elapsed_ms: 1000,
      },
    ]]);
    const result = await setActionOutcome(sql, 'org_1', 'act_1', {
      status: 'partial',
      progress: { step: 2, ratio: 0.5 },
    });
    expect(result.ok).toBe(true);
    // Tagged template values land as rest args after the strings array.
    // Confirm the JSON-stringified progress was interpolated, not the raw object.
    const callArgs = sql.mock.calls[0];
    const jsonArg = callArgs.find(
      (arg) => typeof arg === 'string' && arg.includes('"step":2'),
    );
    expect(jsonArg).toBeDefined();
  });
});

describe('sweepLostOutcomesForOrg', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns swept rows from the atomic UPDATE', async () => {
    const sql = makeSqlMock([[
      {
        action_id: 'act_1',
        agent_id: 'deploy-bot',
        agent_name: 'Deploy Agent',
        action_type: 'deploy',
        declared_goal: 'ship hotfix',
        created_at: '2026-05-13T00:00:00Z',
        outcome_at: '2026-05-13T00:30:00Z',
      },
    ]]);
    const rows = await sweepLostOutcomesForOrg(sql, 'org_a', 15);
    expect(rows).toHaveLength(1);
    expect(rows[0].action_id).toBe('act_1');
    // Confirm the 15-minute timeout was interpolated as an arg.
    const args = sql.mock.calls[0];
    expect(args).toContain(15);
  });

  it('defaults invalid timeout to 15 minutes', async () => {
    const sql = makeSqlMock([[]]);
    await sweepLostOutcomesForOrg(sql, 'org_a', NaN);
    const args = sql.mock.calls[0];
    expect(args).toContain(15);
  });

  it('floors fractional timeout', async () => {
    const sql = makeSqlMock([[]]);
    await sweepLostOutcomesForOrg(sql, 'org_a', 30.9);
    const args = sql.mock.calls[0];
    expect(args).toContain(30);
  });
});

describe('listOrgsWithStaleOutcomes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns distinct org ids', async () => {
    const sql = makeSqlMock([[{ org_id: 'org_a' }, { org_id: 'org_b' }]]);
    const ids = await listOrgsWithStaleOutcomes(sql, 5);
    expect(ids).toEqual(['org_a', 'org_b']);
  });

  it('clamps a negative lower bound to 1', async () => {
    const sql = makeSqlMock([[]]);
    await listOrgsWithStaleOutcomes(sql, -3);
    const args = sql.mock.calls[0];
    expect(args).toContain(1);
  });

  it('falls back to 5 when lower bound is 0 (treated as unset)', async () => {
    const sql = makeSqlMock([[]]);
    await listOrgsWithStaleOutcomes(sql, 0);
    const args = sql.mock.calls[0];
    expect(args).toContain(5);
  });
});
