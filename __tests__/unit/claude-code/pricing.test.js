import { describe, it, expect } from 'vitest';
import {
  priceFor,
  costForUsage,
  cacheSavingsForUsage,
  cacheHitRate,
  formatUSD,
} from '@/lib/claude-code/pricing.js';

describe('claude-code/pricing', () => {
  it('priceFor returns Opus 4.x rates for opus-4-7', () => {
    // Opus 4.5/4.6/4.7 family per Anthropic pricing docs:
    // input $5/M, output $25/M, cache_write $6.25/M, cache_read $0.50/M.
    const p = priceFor('claude-opus-4-7');
    expect(p.input).toBe(5.00);
    expect(p.output).toBe(25.00);
    expect(p.cache_write).toBe(6.25);
    expect(p.cache_read).toBe(0.50);
  });

  it('priceFor strips [1m] suffix and resolves to opus-4-7', () => {
    const p = priceFor('claude-opus-4-7[1m]');
    expect(p.input).toBe(5.00);
    expect(p.output).toBe(25.00);
  });

  it('priceFor returns sonnet rates', () => {
    const p = priceFor('claude-sonnet-4-6');
    expect(p.input).toBe(3.00);
    expect(p.cache_read).toBe(0.30);
  });

  it('priceFor falls back for unknown model', () => {
    const p = priceFor('totally-made-up-model');
    expect(p.input).toBe(3.00);
  });

  it('costForUsage handles Opus mixed cache scenario', () => {
    const usage = {
      input_tokens: 6,
      output_tokens: 438,
      cache_creation_input_tokens: 15551,
      cache_read_input_tokens: 29248,
    };
    const cost = costForUsage('claude-opus-4-7', usage);
    // 6*5 + 438*25 + 15551*6.25 + 29248*0.50 = 30 + 10950 + 97193.75 + 14624 = 122797.75 micro-USD / 1e6
    expect(Math.abs(cost - 0.12279775)).toBeLessThan(1e-6);
  });

  it('costForUsage with no usage data returns 0', () => {
    expect(costForUsage('claude-opus-4-7', null)).toBe(0);
    expect(costForUsage(null, {})).toBe(0);
  });

  it('cacheSavingsForUsage shows real $ saved vs full input price', () => {
    const usage = { cache_read_input_tokens: 29248 };
    const save = cacheSavingsForUsage('claude-opus-4-7', usage);
    // 29248 * (5 - 0.5) / 1e6 = 0.131616
    expect(Math.abs(save - 0.131616)).toBeLessThan(1e-6);
  });

  it('cacheHitRate computes read / (read + write + input)', () => {
    const rate = cacheHitRate({ input_tokens: 100, cache_read_tokens: 700, cache_creation_tokens: 200 });
    expect(Math.abs(rate - 0.7)).toBeLessThan(1e-9);
  });

  it('cacheHitRate returns 0 for empty totals', () => {
    expect(cacheHitRate({})).toBe(0);
  });

  it('formatUSD renders two-decimal dollar amounts', () => {
    expect(formatUSD(1.234)).toBe('$1.23');
    expect(formatUSD(0)).toBe('$0.00');
    expect(formatUSD(1000)).toBe('$1000.00');
  });
});
