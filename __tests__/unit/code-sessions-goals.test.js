/**
 * Unit tests for the pure /goal autopsy assembler in app/lib/claude-code/goals.js.
 *
 * buildAutopsyFromDetail is the shared helper the autopsy API route AND the
 * session-detail UI both call, so the verdict can't drift between them. These
 * tests pin the assembly: user-turn extraction, the final-summary cue that
 * drives the COMPLETED vs THRASHED outcome, goal-text extraction, and the
 * money-bucket breakdown. (The route test mocks this helper and only checks
 * wiring; the real heuristic is exercised here.)
 */
import { describe, expect, it } from 'vitest';
import {
  buildAutopsyFromDetail,
  OUTCOMES,
} from '@/lib/claude-code/goals.js';

const baseSession = {
  id: 'cs_1',
  session_uuid: 'sess-1',
  message_count: 3,
  cost_usd: 1.25,
  model_primary: 'claude-opus-4-8',
  started_at: '2026-05-31T00:00:00.000Z',
  ended_at: '2026-05-31T00:05:00.000Z',
};

describe('buildAutopsyFromDetail', () => {
  it('extracts the /goal text from a user turn', () => {
    const out = buildAutopsyFromDetail({
      session: baseSession,
      messages: [
        { role: 'user', text_preview: '/goal ship the autopsy panel' },
        { role: 'assistant', text_preview: 'done, all tests pass' },
      ],
      toolUses: [],
    });
    expect(out.goal_text).toBe('ship the autopsy panel');
  });

  it('classifies a session with a final-summary cue as completed', () => {
    const out = buildAutopsyFromDetail({
      session: baseSession,
      messages: [
        { role: 'user', text_preview: 'fix the build' },
        { role: 'assistant', text_preview: 'all tests pass, done' },
      ],
      toolUses: [{ name: 'Bash', request_id: 'R1', target: 'npm test' }],
    });
    expect(out.outcome).toBe(OUTCOMES.COMPLETED);
  });

  it('does not treat a non-completion final turn as a summary (no false completed)', () => {
    // No summary cue + no tool activity → not COMPLETED. Pin the exact branch:
    // classifyOutcome returns THRASHED when there's no cue and no tool calls.
    const out = buildAutopsyFromDetail({
      session: { ...baseSession, message_count: 2 },
      messages: [
        { role: 'user', text_preview: 'add a feature' },
        { role: 'assistant', text_preview: 'still working on it' },
      ],
      toolUses: [],
    });
    expect(out.outcome).toBe(OUTCOMES.THRASHED);
  });

  it('summarizes where the cost went, leading with the model bucket', () => {
    const out = buildAutopsyFromDetail({
      session: baseSession,
      messages: [{ role: 'user', text_preview: 'do work' }],
      toolUses: [
        { name: 'Read', request_id: 'R1', target: 'a.js' },
        { name: 'Bash', request_id: 'R2', target: 'npm test' },
      ],
    });
    expect(Array.isArray(out.where_money_went)).toBe(true);
    expect(out.where_money_went[0].bucket).toBe('model:claude-opus-4-8');
    // tool buckets are present alongside the model bucket
    expect(out.where_money_went.some(b => b.bucket.startsWith('tool:'))).toBe(true);
  });

  it('computes elapsed_ms from session timestamps and carries cost/turns through', () => {
    const out = buildAutopsyFromDetail({
      session: baseSession,
      messages: [],
      toolUses: [],
    });
    expect(out.elapsed_ms).toBe(5 * 60 * 1000);
    expect(out.cost_usd).toBe(1.25);
    expect(out.turns).toBe(3);
  });

  it('tolerates empty messages/toolUses (defaults) without throwing', () => {
    const out = buildAutopsyFromDetail({ session: baseSession });
    expect(out.session_id).toBe('cs_1');
    expect(out.goal_text).toBeNull();
  });
});
