import { describe, it, expect } from 'vitest';
import {
  classifyOutcome,
  extractGoalText,
  topMoneyBuckets,
  buildAutopsy,
  OUTCOMES,
} from '@/lib/claude-code/goals.js';

describe('claude-code/goals', () => {
  it('classifyOutcome -> completed when there is a final summary', () => {
    const r = classifyOutcome({}, { stuckLoops: [], toolCount: 5, hasFinalSummary: true });
    expect(r).toBe(OUTCOMES.COMPLETED);
  });

  it('classifyOutcome -> thrashed when many stuck-loop groups', () => {
    const r = classifyOutcome({}, { stuckLoops: [{ count: 3 }, { count: 3 }, { count: 3 }], toolCount: 20, hasFinalSummary: false });
    expect(r).toBe(OUTCOMES.THRASHED);
  });

  it('classifyOutcome -> thrashed when >=30% of tool calls inside loops and no summary', () => {
    const r = classifyOutcome({}, { stuckLoops: [{ count: 4 }], toolCount: 10, hasFinalSummary: false });
    expect(r).toBe(OUTCOMES.THRASHED);
  });

  it('classifyOutcome -> timed_out when elapsedMs >= timeoutMs', () => {
    const r = classifyOutcome({}, { stuckLoops: [], toolCount: 3, elapsedMs: 60_000, timeoutMs: 30_000 });
    expect(r).toBe(OUTCOMES.TIMED_OUT);
  });

  it('classifyOutcome -> aborted on abort signal', () => {
    const r = classifyOutcome({}, { stuckLoops: [], toolCount: 1, hasAbortSignal: true });
    expect(r).toBe(OUTCOMES.ABORTED);
  });

  it('classifyOutcome -> fell_back_to_rules when explicit signal present', () => {
    const r = classifyOutcome({}, { stuckLoops: [], toolCount: 5, fellBackToRules: true, hasFinalSummary: true });
    expect(r).toBe(OUTCOMES.FELL_BACK_TO_RULES);
  });

  it('classifyOutcome -> completed by default when there was tool activity and no negative signal', () => {
    const r = classifyOutcome({}, { stuckLoops: [], toolCount: 4, hasFinalSummary: false });
    expect(r).toBe(OUTCOMES.COMPLETED);
  });

  it('classifyOutcome -> thrashed when no tool activity and no summary', () => {
    const r = classifyOutcome({}, { stuckLoops: [], toolCount: 0, hasFinalSummary: false });
    expect(r).toBe(OUTCOMES.THRASHED);
  });

  it('extractGoalText pulls from /goal user turn', () => {
    const g = extractGoalText(['hi', '/goal Build the thing']);
    expect(g).toBe('Build the thing');
  });

  it('extractGoalText accepts explicit goal field', () => {
    const g = extractGoalText([], 'Explicit goal here');
    expect(g).toBe('Explicit goal here');
  });

  it('extractGoalText truncates very long text', () => {
    const long = '/goal ' + 'x'.repeat(500);
    const g = extractGoalText([long]);
    expect(g.endsWith('...')).toBe(true);
    expect(g.length).toBeLessThanOrEqual(240);
  });

  it('topMoneyBuckets returns model bucket and top tool category', () => {
    const session = { model_primary: 'claude-opus-4-7', cost_usd: 4 };
    const tools = [
      { name: 'Read' }, { name: 'Read' }, { name: 'Edit' },
      { name: 'Bash' }, { name: 'Read' },
    ];
    const buckets = topMoneyBuckets(session, tools);
    expect(buckets[0].bucket).toBe('model:claude-opus-4-7');
    const toolBuckets = buckets.filter(b => b.bucket.startsWith('tool:'));
    expect(toolBuckets[0].bucket).toBe('tool:read');
    expect(Math.abs(toolBuckets[0].share - 3 / 5)).toBeLessThan(1e-9);
  });

  it('buildAutopsy returns the full record shape', () => {
    const session = { id: 1, session_uuid: 'abc', cost_usd: 3.0, message_count: 12, started_at: '2026-05-12T00:00:00Z', ended_at: '2026-05-12T00:10:00Z' };
    const r = buildAutopsy({
      session,
      userTurns: ['/goal demo'],
      stuckLoops: [],
      toolEvents: [{ name: 'Read' }, { name: 'Edit' }, { name: 'Bash' }],
      hasFinalSummary: true,
    });
    expect(r.session_uuid).toBe('abc');
    expect(r.goal_text).toBe('demo');
    expect(r.outcome).toBe(OUTCOMES.COMPLETED);
    expect(r.turns).toBe(12);
    expect(Array.isArray(r.where_money_went)).toBe(true);
    expect(r.elapsed_ms).toBeGreaterThanOrEqual(600_000);
  });
});
