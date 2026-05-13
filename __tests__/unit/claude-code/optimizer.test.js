import { describe, it, expect } from 'vitest';
import { runOptimizer, totalEstimatedMonthlySavings } from '@/lib/claude-code/optimizer.js';
import MODEL_DOWNSHIFT from '@/lib/claude-code/rules/model-downshift.js';
import CACHE_WRITE_BLOAT from '@/lib/claude-code/rules/cache-write-bloat.js';
import STUCK_LOOP_COST from '@/lib/claude-code/rules/stuck-loop-cost.js';
import SUBAGENT_PROMPT_BLOAT from '@/lib/claude-code/rules/subagent-prompt-bloat.js';
import REPEATED_READ_CYCLES from '@/lib/claude-code/rules/repeated-read-cycles.js';
import BAD_CACHE_HIT from '@/lib/claude-code/rules/bad-cache-hit.js';

describe('claude-code/optimizer + rules', () => {
  it('MODEL_DOWNSHIFT fires when Opus runs a small short-output session', () => {
    const session = {
      model_primary: 'claude-opus-4-7',
      message_count: 10,
      input_tokens: 5000,
      output_tokens: 4000,
      cache_read_tokens: 1000,
      cache_creation_tokens: 1000,
      cost_usd: 0.5,
    };
    const out = MODEL_DOWNSHIFT.inspect({ session });
    expect(out).toBeTruthy();
    expect(out.ruleId).toBe('MODEL_DOWNSHIFT');
    expect(out.estimatedMonthlySavingsUsd).toBeGreaterThan(0);
  });

  it('MODEL_DOWNSHIFT does not fire on non-Opus models', () => {
    const session = {
      model_primary: 'claude-sonnet-4-6',
      message_count: 10,
      input_tokens: 5000, output_tokens: 4000,
      cache_read_tokens: 0, cache_creation_tokens: 0,
    };
    expect(MODEL_DOWNSHIFT.inspect({ session })).toBe(null);
  });

  it('MODEL_DOWNSHIFT does not fire on huge Opus sessions', () => {
    const session = {
      model_primary: 'claude-opus-4-7',
      message_count: 100,
      input_tokens: 500_000, output_tokens: 200_000,
      cache_read_tokens: 0, cache_creation_tokens: 0,
    };
    expect(MODEL_DOWNSHIFT.inspect({ session })).toBe(null);
  });

  it('CACHE_WRITE_BLOAT fires when writes are >3x reads', () => {
    const session = {
      model_primary: 'claude-opus-4-7',
      cache_creation_tokens: 50_000,
      cache_read_tokens: 10_000,
    };
    const out = CACHE_WRITE_BLOAT.inspect({ session });
    expect(out).toBeTruthy();
    expect(out.ruleId).toBe('CACHE_WRITE_BLOAT');
    expect(out.evidence.ratio).toBeGreaterThanOrEqual(3);
    expect(out.estimatedMonthlySavingsUsd).toBeGreaterThanOrEqual(0);
  });

  it('CACHE_WRITE_BLOAT does not fire on healthy 1:1 ratio', () => {
    const session = {
      model_primary: 'claude-opus-4-7',
      cache_creation_tokens: 5000, cache_read_tokens: 5000,
    };
    expect(CACHE_WRITE_BLOAT.inspect({ session })).toBe(null);
  });

  it('STUCK_LOOP_COST estimates loop $ from session cost', () => {
    const session = { cost_usd: 4.0 };
    const stuckLoops = [{ name: 'Read', count: 4 }];
    const out = STUCK_LOOP_COST.inspect({ session, stuckLoops, toolCount: 10 });
    expect(out).toBeTruthy();
    expect(out.ruleId).toBe('STUCK_LOOP_COST');
    expect(Math.abs(out.estimatedMonthlySavingsUsd - 1.6)).toBeLessThan(1e-6);
  });

  it('STUCK_LOOP_COST does not fire without loops', () => {
    expect(STUCK_LOOP_COST.inspect({ session: { cost_usd: 1 }, stuckLoops: [], toolCount: 5 })).toBe(null);
  });

  it('SUBAGENT_PROMPT_BLOAT flags repeat invocations sharing a >8k prefix', () => {
    const out = SUBAGENT_PROMPT_BLOAT.inspect({
      session: { model_primary: 'claude-sonnet-4-6' },
      subagentInvocations: [
        { parentTool: 'Agent', prefixHash: 'X', prefixTokens: 9000 },
        { parentTool: 'Agent', prefixHash: 'X', prefixTokens: 9000 },
      ],
    });
    expect(out).toBeTruthy();
    expect(out.ruleId).toBe('SUBAGENT_PROMPT_BLOAT');
    expect(out.estimatedMonthlySavingsUsd).toBeGreaterThan(0);
  });

  it('SUBAGENT_PROMPT_BLOAT does not fire on small prefixes', () => {
    const out = SUBAGENT_PROMPT_BLOAT.inspect({
      session: { model_primary: 'claude-sonnet-4-6' },
      subagentInvocations: [
        { parentTool: 'Agent', prefixHash: 'A', prefixTokens: 500 },
        { parentTool: 'Agent', prefixHash: 'A', prefixTokens: 500 },
      ],
    });
    expect(out).toBe(null);
  });

  it('REPEATED_READ_CYCLES fires on Read->Edit->Read >=3 times on same target', () => {
    const seq = [];
    for (let i = 0; i < 3; i++) {
      seq.push({ name: 'Read', target: 'app.js' });
      seq.push({ name: 'Edit', target: 'app.js' });
    }
    seq.push({ name: 'Read', target: 'app.js' });
    const out = REPEATED_READ_CYCLES.inspect({ toolEvents: seq });
    expect(out).toBeTruthy();
    expect(out.ruleId).toBe('REPEATED_READ_CYCLES');
    expect(out.evidence.offenders.find(o => o.target === 'app.js')).toBeTruthy();
  });

  it('REPEATED_READ_CYCLES does not fire on a single Read->Edit->Read pair', () => {
    const seq = [
      { name: 'Read', target: 'a' }, { name: 'Edit', target: 'a' }, { name: 'Read', target: 'a' },
      { name: 'Bash' },
    ];
    expect(REPEATED_READ_CYCLES.inspect({ toolEvents: seq })).toBe(null);
  });

  it('BAD_CACHE_HIT fires on 3 consecutive low-hit sessions', () => {
    const lo = (uuid) => ({
      session_uuid: uuid, started_at: '2026-05-01T00:00:00Z',
      model_primary: 'claude-opus-4-7',
      input_tokens: 10000, output_tokens: 1000,
      cache_read_tokens: 100, cache_creation_tokens: 100, cost_usd: 0.1,
    });
    const out = BAD_CACHE_HIT.inspect({ projectSessions: [lo('a'), lo('b'), lo('c')] });
    expect(out).toBeTruthy();
    expect(out.ruleId).toBe('BAD_CACHE_HIT');
    expect(out.evidence.streak).toBe(3);
  });

  it('BAD_CACHE_HIT does not fire when last session is healthy', () => {
    const lo = (uuid) => ({ session_uuid: uuid, input_tokens: 10000, output_tokens: 1000, cache_read_tokens: 100, cache_creation_tokens: 100, cost_usd: 0.1, model_primary: 'claude-opus-4-7' });
    const hi = (uuid) => ({ session_uuid: uuid, input_tokens: 100, output_tokens: 1000, cache_read_tokens: 10000, cache_creation_tokens: 100, cost_usd: 0.1, model_primary: 'claude-opus-4-7' });
    expect(BAD_CACHE_HIT.inspect({ projectSessions: [lo('a'), lo('b'), hi('c')] })).toBe(null);
  });

  it('runOptimizer aggregates findings from multiple rules', () => {
    const session = {
      model_primary: 'claude-opus-4-7',
      message_count: 8,
      input_tokens: 5000, output_tokens: 4000,
      cache_read_tokens: 5000, cache_creation_tokens: 50_000,
      cost_usd: 5,
    };
    const findings = runOptimizer({
      session,
      stuckLoops: [{ name: 'Read', count: 4 }],
      toolCount: 10,
      toolEvents: [],
      subagentInvocations: [],
      projectSessions: [],
    });
    const ids = findings.map(f => f.ruleId);
    expect(ids).toContain('MODEL_DOWNSHIFT');
    expect(ids).toContain('CACHE_WRITE_BLOAT');
    expect(ids).toContain('STUCK_LOOP_COST');
    const total = totalEstimatedMonthlySavings(findings);
    expect(total).toBeGreaterThan(0);
  });
});
