import { describe, it, expect } from 'vitest';
import {
  detectStuckLoops,
  detectCostAnomalies,
  cacheHealth,
  summarizeInsights,
} from '@/lib/claude-code/insights.js';

describe('claude-code/insights', () => {
  it('detectStuckLoops flags 3+ consecutive same-tool calls', () => {
    const tools = [
      { name: 'Read' }, { name: 'Read' }, { name: 'Read' }, { name: 'Read' },
      { name: 'Edit' }, { name: 'Bash' },
    ];
    const loops = detectStuckLoops(tools);
    expect(loops.length).toBe(1);
    expect(loops[0].name).toBe('Read');
    expect(loops[0].count).toBe(4);
    expect(loops[0].startIndex).toBe(0);
    expect(loops[0].endIndex).toBe(3);
  });

  it('detectStuckLoops handles loop at end of sequence', () => {
    const tools = [
      { name: 'Edit' },
      { name: 'Bash' }, { name: 'Bash' }, { name: 'Bash' },
    ];
    const loops = detectStuckLoops(tools);
    expect(loops.length).toBe(1);
    expect(loops[0].name).toBe('Bash');
    expect(loops[0].count).toBe(3);
  });

  it('detectStuckLoops returns empty when no 3-run exists', () => {
    const tools = [
      { name: 'Read' }, { name: 'Read' }, { name: 'Edit' }, { name: 'Read' },
    ];
    expect(detectStuckLoops(tools)).toEqual([]);
  });

  it('detectStuckLoops handles empty input', () => {
    expect(detectStuckLoops([])).toEqual([]);
  });

  it('detectCostAnomalies needs at least 3 prior costs', () => {
    const r = detectCostAnomalies(5, [1, 2]);
    expect(r.flagged).toBe(false);
    expect(r.reason).toBe('insufficient_history');
  });

  it('detectCostAnomalies flags 3x median', () => {
    const priors = [1, 1, 1, 1, 1];
    const r = detectCostAnomalies(3.5, priors);
    expect(r.flagged).toBe(true);
    expect(r.median).toBe(1);
    expect(r.ratio).toBeGreaterThanOrEqual(3);
  });

  it('detectCostAnomalies does not flag within band', () => {
    const r = detectCostAnomalies(2, [1, 1, 1, 1]);
    expect(r.flagged).toBe(false);
    expect(r.reason).toBe('within_band');
  });

  it('detectCostAnomalies guards against median 0', () => {
    const r = detectCostAnomalies(5, [0, 0, 0]);
    expect(r.flagged).toBe(false);
    expect(r.reason).toBe('median_zero');
  });

  it('cacheHealth flags below 30%', () => {
    const r = cacheHealth({ input_tokens: 1000, cache_read_tokens: 100, cache_creation_tokens: 200 });
    expect(r.flagged).toBe(true);
  });

  it('cacheHealth passes above 30%', () => {
    const r = cacheHealth({ input_tokens: 100, cache_read_tokens: 700, cache_creation_tokens: 200 });
    expect(r.flagged).toBe(false);
  });

  it('summarizeInsights returns full report shape', () => {
    const tools = [{ name: 'Read' }, { name: 'Read' }, { name: 'Read' }];
    const r = summarizeInsights({
      toolUses: tools,
      currentCost: 5,
      priorCosts: [1, 1, 1, 1],
      totals: { input_tokens: 10, cache_read_tokens: 1, cache_creation_tokens: 1 },
    });
    expect(r.stuck_loops.length).toBe(1);
    expect(r.cost_anomaly.flagged).toBe(true);
    expect(r.cache_health.flagged).toBe(true);
  });
});
