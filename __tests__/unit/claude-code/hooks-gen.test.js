import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  generateHook,
  renderStuckLoopGuard,
  renderCostLimitGuard,
  renderInstallInstructions,
  safeFilename,
  STUCK_LOOP_DEFAULT_THRESHOLD,
} from '@/lib/claude-code/hooks-gen.js';

describe('claude-code/hooks-gen', () => {
  it('safeFilename rejects unknown kinds and returns predictable names', () => {
    expect(safeFilename('stuck-loop')).toBe('dashclaw-stuck-loop-guard.py');
    expect(safeFilename('cost-limit')).toBe('dashclaw-cost-limit-guard.py');
    expect(() => safeFilename('rm-rf')).toThrow(/unsupported hook kind/);
  });

  it('stuck-loop guard script has a shebang, a threshold, and a state directory', () => {
    const out = renderStuckLoopGuard({ threshold: 7, sessionId: 'abc', projectSlug: 'demo' });
    expect(out).toMatch(/^#!\/usr\/bin\/env python3/);
    expect(out).toMatch(/THRESHOLD = 7/);
    expect(out).toMatch(/\.claude-dashclaw/);
    expect(out).toMatch(/sys\.exit\(main\(\)\)/);
    expect(out).toMatch(/stuck-loop guard/i);
  });

  it('stuck-loop guard falls back to the default threshold for bogus input', () => {
    const out = renderStuckLoopGuard({ threshold: -1 });
    expect(out).toMatch(new RegExp(`THRESHOLD = ${STUCK_LOOP_DEFAULT_THRESHOLD}`));
  });

  it('cost-limit guard uses 3x project median when one is provided', () => {
    const out = renderCostLimitGuard({ projectMedianUsd: 2.5, sessionId: 'sess', projectSlug: 'demo' });
    expect(out).toMatch(/LIMIT_USD = 7\.5000/);
    expect(out).toMatch(/PostToolUse/);
    expect(out).toMatch(/claude-opus-4-7/);
  });

  it('cost-limit guard accepts an explicit threshold', () => {
    const out = renderCostLimitGuard({ thresholdUsd: 12.5 });
    expect(out).toMatch(/LIMIT_USD = 12\.5000/);
  });

  it('cost-limit guard sources prices from the canonical table (Opus 4.8 at $5, not legacy $15)', () => {
    // The PRICES dict is now generated from PRICES_PER_MTOK instead of being a
    // hand-maintained mirror that drifted: opus-4-7 used to be hardcoded at the
    // legacy $15/$75 and opus-4-8 was absent. Both must reflect the $5/$25 rate.
    const out = renderCostLimitGuard({ thresholdUsd: 5 });
    expect(out).toMatch(/"claude-opus-4-8": \{"input": 5,/);
    expect(out).toMatch(/"claude-opus-4-7": \{"input": 5,/);
    expect(out).toMatch(/DEFAULT_PRICE = \{"input": 3,/);
  });

  it('renderInstallInstructions produces a valid settings.json snippet', () => {
    const inst = renderInstallInstructions({ kind: 'stuck-loop', scriptPath: '/abs/path/hook.py' });
    expect(inst.hookEvent).toBe('PreToolUse');
    const parsed = JSON.parse(inst.snippetJson);
    expect(parsed.hooks.PreToolUse).toBeTruthy();
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe('python "/abs/path/hook.py"');
    expect(inst.steps.length).toBeGreaterThanOrEqual(3);
  });

  it('generateHook builds the full bundle for stuck-loop', () => {
    const result = generateHook({
      kind: 'stuck-loop',
      threshold: 4,
      sessionId: 'session-uuid',
      projectSlug: 'pokerclaw',
      projectCwd: '/tmp/pokerclaw',
    });
    expect(result.kind).toBe('stuck-loop');
    expect(result.filename).toBe('dashclaw-stuck-loop-guard.py');
    expect(result.relativePath).toBe(path.join('.claude', 'hooks', 'dashclaw-stuck-loop-guard.py'));
    expect(result.suggestedPath).toBe(path.join('/tmp/pokerclaw', '.claude', 'hooks', 'dashclaw-stuck-loop-guard.py'));
    expect(result.content).toMatch(/THRESHOLD = 4/);
    expect(result.install.hookEvent).toBe('PreToolUse');
  });

  it('generateHook for cost-limit returns PostToolUse install metadata', () => {
    const result = generateHook({
      kind: 'cost-limit',
      thresholdUsd: 10,
      sessionId: 'session-uuid',
      projectSlug: 'demo',
      projectCwd: '/tmp/demo',
    });
    expect(result.kind).toBe('cost-limit');
    expect(result.content).toMatch(/LIMIT_USD = 10\.0000/);
    expect(result.install.hookEvent).toBe('PostToolUse');
  });

  it('generateHook refuses unknown kinds', () => {
    expect(() => generateHook({ kind: 'magic' })).toThrow(/unsupported hook kind/);
  });
});
