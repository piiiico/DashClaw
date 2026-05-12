import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCapabilityHealthSummary } from '../../app/lib/capability-health.js';

function makeSqlMock(responses) {
  const queue = [...responses];
  return vi.fn((strings) => {
    if (Array.isArray(strings) && strings.length === 1 && strings[0] === '') {
      return Promise.resolve([]);
    }
    const next = queue.shift() ?? [];
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    return Promise.resolve(next);
  });
}

describe('getCapabilityHealthSummary', () => {
  // Pin clock to one day after the fixture dates so the 30-day staleness
  // threshold (capability-health.js:57) doesn't flip 'certified' to 'stale'
  // when the suite runs more than a month after the test was authored.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives healthy status from successful recent invocations', async () => {
    const sql = makeSqlMock([
      [{
        total_invocations: '4',
        successful_invocations: '4',
        failed_invocations: '0',
        pending_approvals: '0',
        total_invocations_1d: '2',
        successful_invocations_1d: '2',
        last_success_at: '2026-04-07T00:00:00.000Z',
        last_failure_at: null,
        p95_latency_ms: '120',
      }],
      [],
      [{
        action_id: 'act_test_1',
        status: 'completed',
        timestamp_start: '2026-04-07T02:00:00.000Z',
        duration_ms: '42',
        output_summary: 'ok',
        error_message: null,
      }],
    ]);

    const summary = await getCapabilityHealthSummary(sql, 'org_1', {
      slug: 'research-agent',
      health_status: 'unknown',
    });

    expect(summary.status).toBe('healthy');
    expect(summary.total_invocations).toBe(4);
    expect(summary.success_rate_1d).toBe(100);
    expect(summary.success_rate_7d).toBe(100);
    expect(summary.p95_latency_ms).toBe(120);
    expect(summary.certification_status).toBe('certified');
    expect(summary.last_test_status).toBe('completed');
    expect(summary.last_test_action_id).toBe('act_test_1');
    expect(summary.stale_check).toBe(false);
    expect(summary.recent_errors).toEqual([]);
  });

  it('derives failing status when recent invocations only failed', async () => {
    const sql = makeSqlMock([
      [{
        total_invocations: '3',
        successful_invocations: '0',
        failed_invocations: '3',
        pending_approvals: '0',
        total_invocations_1d: '1',
        successful_invocations_1d: '0',
        last_success_at: null,
        last_failure_at: '2026-04-07T01:00:00.000Z',
        p95_latency_ms: '900',
      }],
      [{ error_message: 'downstream timeout', timestamp_start: '2026-04-07T01:00:00.000Z' }],
      [{
        action_id: 'act_test_2',
        status: 'failed',
        timestamp_start: '2026-04-07T00:30:00.000Z',
        duration_ms: '55',
        output_summary: null,
        error_message: 'input.query is required',
      }],
    ]);

    const summary = await getCapabilityHealthSummary(sql, 'org_1', {
      slug: 'research-agent',
      health_status: 'healthy',
    });

    expect(summary.status).toBe('failing');
    expect(summary.failed_invocations).toBe(3);
    expect(summary.success_rate_1d).toBe(0);
    expect(summary.certification_status).toBe('failed');
    expect(summary.last_test_status).toBe('failed');
    expect(summary.recent_errors[0].message).toBe('downstream timeout');
  });

  it('returns untested when there is no invocation history', async () => {
    const sql = makeSqlMock([
      [{
        total_invocations: '0',
        successful_invocations: '0',
        failed_invocations: '0',
        pending_approvals: '0',
        total_invocations_1d: '0',
        successful_invocations_1d: '0',
        last_success_at: null,
        last_failure_at: null,
        p95_latency_ms: null,
      }],
      [],
      [],
    ]);

    const summary = await getCapabilityHealthSummary(sql, 'org_1', {
      slug: 'research-agent',
      health_status: 'unknown',
    });

    expect(summary.status).toBe('untested');
    expect(summary.certification_status).toBe('uncertified');
    expect(summary.last_tested_at).toBeNull();
    expect(summary.stale_check).toBe(true);
    expect(summary.success_rate_7d).toBe(0);
  });

  it('falls back to legacy action_records columns when runtime fields are unavailable', async () => {
    const missingColumn = new Error('column "duration_ms" does not exist');
    missingColumn.code = '42703';

    const sql = makeSqlMock([
      missingColumn,
      [],
      [],
      [{
        total_invocations: '2',
        successful_invocations: '2',
        failed_invocations: '0',
        pending_approvals: '0',
        total_invocations_1d: '1',
        successful_invocations_1d: '1',
        last_success_at: '2026-04-07T00:00:00.000Z',
        last_failure_at: null,
      }],
      [{
        action_id: 'act_test_legacy',
        status: 'completed',
        timestamp_start: '2026-04-07T02:00:00.000Z',
      }],
    ]);

    const summary = await getCapabilityHealthSummary(sql, 'org_1', {
      slug: 'research-agent',
      health_status: 'unknown',
    });

    expect(summary.status).toBe('healthy');
    expect(summary.total_invocations).toBe(2);
    expect(summary.success_rate_1d).toBe(100);
    expect(summary.success_rate_7d).toBe(100);
    expect(summary.p95_latency_ms).toBeNull();
    expect(summary.last_test_status).toBe('completed');
    expect(summary.last_test_action_id).toBe('act_test_legacy');
    expect(summary.recent_errors).toEqual([]);
  });
});
