import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqlMock } from '../helpers.js';
import { updateSession, listSessions, getSession, TERMINAL_STATUSES } from '../../app/lib/sessions.js';

// ensureTables() is gated on a globalThis flag and fires CREATE TABLE/INDEX
// round-trips on first call. Pin it true so each test exercises only the
// statement(s) under inspection deterministically.
beforeEach(() => { globalThis.__dashclaw_sessions_table_checked = true; });
afterEach(() => { globalThis.__dashclaw_sessions_table_checked = false; });

describe('updateSession — terminal summary salvage', () => {
  it('records the session_end summary as the terminal event detail', async () => {
    const sql = createSqlMock({ taggedResponses: [
      [{ id: 'sess_1', status: 'completed' }], // UPDATE ... RETURNING *
      [], // INSERT INTO session_events ... SELECT
    ] });

    await updateSession(sql, 'sess_1', 'org_1', { status: 'completed', summary: 'shipped it' });

    // The INSERT is the last tagged call; its detail value carries the summary.
    const insert = sql.taggedCalls[sql.taggedCalls.length - 1];
    expect(insert.text).toMatch(/INSERT INTO session_events/);
    expect(insert.values).toContain('shipped it');
    expect(insert.values).toContain('completed');
  });

  it('still uses blocked_reason (not summary) as detail on a blocked transition', async () => {
    const sql = createSqlMock({ taggedResponses: [
      [{ id: 'sess_1', status: 'blocked' }],
      [],
    ] });

    await updateSession(sql, 'sess_1', 'org_1', {
      status: 'blocked',
      blocked_reason: 'awaiting review',
      summary: 'should be ignored here',
    });

    const insert = sql.taggedCalls[sql.taggedCalls.length - 1];
    expect(insert.values).toContain('awaiting review');
    expect(insert.values).not.toContain('should be ignored here');
  });

  it('does not record a summary as detail for a non-terminal status', async () => {
    const sql = createSqlMock({ taggedResponses: [
      [{ id: 'sess_1', status: 'running' }],
      [],
    ] });

    await updateSession(sql, 'sess_1', 'org_1', { status: 'running', summary: 'noise' });

    const insert = sql.taggedCalls[sql.taggedCalls.length - 1];
    expect(insert.values).not.toContain('noise');
  });
});

describe('session aggregation shaping', () => {
  it('coerces numeric aggregate columns and prefers last_action_at for last_activity', async () => {
    const sql = createSqlMock({ taggedResponses: [
      // First response is consumed by the embedded sessionAggregateSql() fragment
      // (the interpolated LEFT JOIN LATERAL sub-template), which is evaluated
      // before the outer SELECT. The second response is the actual row set.
      [],
      [{
        id: 'sess_1', org_id: 'org_1', agent_id: 'a', status: 'running',
        last_activity: '2026-06-01T00:00:00Z',
        action_count: '5', total_cost: '1.25', max_risk: '70', event_count: '3',
        last_action_at: '2026-06-04T00:00:00Z',
      }],
    ] });

    const rows = await listSessions(sql, 'org_1');
    expect(rows[0].action_count).toBe(5);
    expect(rows[0].total_cost).toBe(1.25);
    expect(rows[0].max_risk).toBe(70);
    expect(rows[0].event_count).toBe(3);
    // last_action_at wins over the stored last_activity column.
    expect(rows[0].last_activity).toBe('2026-06-04T00:00:00Z');
  });

  it('getSession joins action_records and session_events for aggregates', async () => {
    const sql = createSqlMock({ taggedResponses: [
      [], // embedded sessionAggregateSql() fragment
      [{ id: 'sess_1', org_id: 'org_1', agent_id: 'a', status: 'completed', action_count: '2', total_cost: '0', max_risk: '0', event_count: '4' }],
    ] });

    const session = await getSession(sql, 'sess_1', 'org_1');
    // The embedded aggregate fragment (first recorded call) carries the joins;
    // the outer SELECT (last call) interpolates it as a placeholder.
    const fragment = sql.taggedCalls[0];
    expect(fragment.text).toMatch(/LEFT JOIN LATERAL/);
    expect(fragment.text).toMatch(/action_records/);
    expect(fragment.text).toMatch(/session_events/);
    const outer = sql.taggedCalls[sql.taggedCalls.length - 1];
    expect(outer.text).toMatch(/FROM agent_sessions s/);
    expect(session.action_count).toBe(2);
    expect(session.event_count).toBe(4);
  });
});

describe('TERMINAL_STATUSES export', () => {
  it('includes all ended states so duration freezes correctly', () => {
    for (const s of ['finished', 'failed', 'closed', 'completed', 'cancelled']) {
      expect(TERMINAL_STATUSES).toContain(s);
    }
  });
});
