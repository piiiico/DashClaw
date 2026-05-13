import { describe, it, expect } from 'vitest';
import { computeRoi, recommend, KEEP, TRIM, DROP } from '@/lib/claude-code/subagent-roi.js';

describe('claude-code/subagent-roi', () => {
  it('computeRoi aggregates count, total cost, avg cost, avg duration', () => {
    const rows = computeRoi([
      { name: 'A', cost_usd: 1.0, duration_ms: 1000, success: true },
      { name: 'A', cost_usd: 3.0, duration_ms: 3000, success: true },
      { name: 'B', cost_usd: 5.0, duration_ms: 500, success: false },
    ]);
    expect(rows[0].name).toBe('B');
    expect(rows[0].invocation_count).toBe(1);
    expect(rows[0].total_cost_usd).toBe(5);
    expect(rows[1].name).toBe('A');
    expect(rows[1].invocation_count).toBe(2);
    expect(rows[1].total_cost_usd).toBe(4);
    expect(rows[1].avg_cost_usd).toBe(2);
    expect(rows[1].avg_duration_ms).toBe(2000);
  });

  it('recommend -> KEEP at high success and low cost', () => {
    expect(recommend({ avgCost: 0.2, successRate: 0.9, invocationCount: 10, costPerSuccess: 0.5 })).toBe(KEEP);
  });

  it('recommend -> DROP at low success rate', () => {
    expect(recommend({ avgCost: 0.5, successRate: 0.2, invocationCount: 5, costPerSuccess: 5 })).toBe(DROP);
  });

  it('recommend -> DROP at high cost-per-success', () => {
    expect(recommend({ avgCost: 1.0, successRate: 0.5, invocationCount: 5, costPerSuccess: 10 })).toBe(DROP);
  });

  it('recommend -> TRIM in the middle band', () => {
    expect(recommend({ avgCost: 0.4, successRate: 0.6, invocationCount: 5, costPerSuccess: 2 })).toBe(TRIM);
  });

  it('recommend -> TRIM with unknown success and high avg cost', () => {
    expect(recommend({ avgCost: 1.0, successRate: null, invocationCount: 5, costPerSuccess: null })).toBe(TRIM);
  });

  it('recommend -> KEEP with unknown success and low avg cost', () => {
    expect(recommend({ avgCost: 0.05, successRate: null, invocationCount: 5, costPerSuccess: null })).toBe(KEEP);
  });

  it('computeRoi handles all-unknown success cleanly', () => {
    const rows = computeRoi([
      { name: 'X', cost_usd: 0.1, duration_ms: 100, success: null },
      { name: 'X', cost_usd: 0.1, duration_ms: 100, success: null },
    ]);
    expect(rows[0].success_rate).toBe(null);
    expect(rows[0].cost_per_success_usd).toBe(null);
    expect(rows[0].recommendation).toBe(KEEP);
  });

  it('cost_per_success math: total_cost / success_count', () => {
    const rows = computeRoi([
      { name: 'P', cost_usd: 2.0, duration_ms: 0, success: true },
      { name: 'P', cost_usd: 2.0, duration_ms: 0, success: true },
      { name: 'P', cost_usd: 6.0, duration_ms: 0, success: false },
    ]);
    expect(rows[0].cost_per_success_usd).toBe(5);
  });
});
