import { describe, it, expect } from 'vitest';

// Pure-function tests for groupEventsByDay + summarizeDay.
//
// Option B active: importing from a sibling helper keeps the JSX-bearing
// page file out of vitest's oxc parser path (Option A failed because
// vite's JSX transform doesn't auto-engage on a plain .js extension at
// import time). app/activity/page.jsx re-exports these for production use.
import { groupEventsByDay, summarizeDay } from '../../app/activity/dayGrouping.js';

// Per D-14: if useAgentFilter is active upstream, the array fed to
// groupEventsByDay is already filtered. groupEventsByDay itself is
// agent-agnostic — it does NOT re-apply any agent filter.

function evt({ id, timestamp, category = 'decision', status = 'completed' }) {
  return { id, timestamp, category, status };
}

describe('groupEventsByDay', () => {
  it('returns an empty array for empty input', () => {
    expect(groupEventsByDay([])).toEqual([]);
  });

  it('groups a single event into one day with a short-weekday label', () => {
    const events = [
      evt({ id: 'a', timestamp: '2026-04-22T15:00:00Z', category: 'decision', status: 'completed' }),
    ];
    const groups = groupEventsByDay(events);
    expect(groups).toHaveLength(1);
    expect(groups[0].dayKey).toBe('2026-04-22');
    // "Wed Apr 22" in en-US short form
    expect(groups[0].label).toMatch(/^\w{3}, \w{3} \d{1,2}$|^\w{3} \w{3} \d{1,2}$/);
    expect(groups[0].events).toHaveLength(1);
    expect(groups[0].counts).toEqual({ approved: 1, denied: 0, allowed: 0, errored: 0 });
  });

  it('collapses two events on the same day into one group', () => {
    const events = [
      evt({ id: 'a', timestamp: '2026-04-22T09:00:00Z' }),
      evt({ id: 'b', timestamp: '2026-04-22T18:00:00Z' }),
    ];
    const groups = groupEventsByDay(events);
    expect(groups).toHaveLength(1);
    expect(groups[0].events).toHaveLength(2);
  });

  it('splits two events on different days into two groups in input order', () => {
    // Feed DESC (newest first) — output preserves insertion order.
    const events = [
      evt({ id: 'newer', timestamp: '2026-04-22T10:00:00Z' }),
      evt({ id: 'older', timestamp: '2026-04-21T10:00:00Z' }),
    ];
    const groups = groupEventsByDay(events);
    expect(groups).toHaveLength(2);
    expect(groups[0].dayKey).toBe('2026-04-22');
    expect(groups[1].dayKey).toBe('2026-04-21');
  });

  it('distributes mixed guard + decision events into the correct count buckets', () => {
    const events = [
      // guard allows
      evt({ id: 'g1', timestamp: '2026-04-22T10:00:00Z', category: 'guard', status: 'allow' }),
      evt({ id: 'g2', timestamp: '2026-04-22T10:01:00Z', category: 'guard', status: 'allow' }),
      // guard blocks + deny
      evt({ id: 'g3', timestamp: '2026-04-22T10:02:00Z', category: 'guard', status: 'block' }),
      evt({ id: 'g4', timestamp: '2026-04-22T10:03:00Z', category: 'guard', status: 'deny' }),
      // decisions
      evt({ id: 'd1', timestamp: '2026-04-22T10:04:00Z', category: 'decision', status: 'completed' }),
      evt({ id: 'd2', timestamp: '2026-04-22T10:05:00Z', category: 'decision', status: 'failed' }),
      evt({ id: 'd3', timestamp: '2026-04-22T10:06:00Z', category: 'decision', status: 'error' }),
    ];
    const groups = groupEventsByDay(events);
    expect(groups).toHaveLength(1);
    expect(groups[0].counts).toEqual({
      approved: 1,
      denied: 2,
      allowed: 2,
      errored: 2,
    });
  });

  it('still emits a group when all counts are zero (e.g. pending-approval only)', () => {
    const events = [
      evt({ id: 'p1', timestamp: '2026-04-22T10:00:00Z', category: 'guard', status: 'require_approval' }),
      evt({ id: 'p2', timestamp: '2026-04-22T10:01:00Z', category: 'decision', status: 'running' }),
    ];
    const groups = groupEventsByDay(events);
    expect(groups).toHaveLength(1);
    expect(groups[0].counts).toEqual({ approved: 0, denied: 0, allowed: 0, errored: 0 });
    expect(groups[0].events).toHaveLength(2);
  });
});

describe('summarizeDay', () => {
  it('uses plural grammar for counts != 1', () => {
    const s = summarizeDay({ counts: { approved: 12, denied: 3, allowed: 47, errored: 0 } });
    expect(s).toMatch(/12 approvals/);
    expect(s).toMatch(/3 denials/);
    expect(s).toMatch(/47 silent allows/);
    expect(s).toMatch(/0 errors/);
  });

  it('uses singular grammar for count == 1', () => {
    const s = summarizeDay({ counts: { approved: 1, denied: 1, allowed: 1, errored: 1 } });
    expect(s).toMatch(/\b1 approval\b/);
    expect(s).toMatch(/\b1 denial\b/);
    expect(s).toMatch(/\b1 silent allow\b/);
    expect(s).toMatch(/\b1 error\b/);
    // No trailing s on the singular variants
    expect(s).not.toMatch(/1 approvals/);
    expect(s).not.toMatch(/1 denials/);
    expect(s).not.toMatch(/1 silent allows/);
    expect(s).not.toMatch(/1 errors/);
  });

  it('renders all-zero days with plural "0 errors" wording', () => {
    const s = summarizeDay({ counts: { approved: 0, denied: 0, allowed: 0, errored: 0 } });
    expect(s).toMatch(/0 approvals/);
    expect(s).toMatch(/0 denials/);
    expect(s).toMatch(/0 silent allows/);
    expect(s).toMatch(/0 errors/);
  });
});
