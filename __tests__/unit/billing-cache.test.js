import { describe, it, expect } from 'vitest';
import { estimateCost, DEFAULT_PRICING } from '@/lib/billing.js';

describe('billing.estimateCost — legacy 4-arg parity', () => {
  it('every existing DEFAULT_PRICING entry returns identical numbers under 4-arg and 5-arg-with-null-extras', () => {
    const tokensIn = 12345;
    const tokensOut = 6789;
    for (const entry of DEFAULT_PRICING) {
      // Pattern matching can be defeated by earlier entries that include() this
      // pattern (e.g. 'opus' matches before 'opus-4-7'). Build a real model
      // identifier that is unique to this entry.
      const model = `claude-${entry.pattern}-eval`;
      const four = estimateCost(tokensIn, tokensOut, model);
      const fiveNull = estimateCost(tokensIn, tokensOut, model, null, null);
      const fiveCustomNull = estimateCost(tokensIn, tokensOut, model, null, undefined);
      expect(fiveNull).toBe(four);
      expect(fiveCustomNull).toBe(four);
    }
  });

  it('unknown model still returns 0 even when extras supplied', () => {
    expect(estimateCost(100, 200, 'totally-made-up-model')).toBe(0);
    expect(estimateCost(100, 200, 'totally-made-up-model', null, { cache_creation_tokens: 1000, cache_read_tokens: 1000 })).toBe(0);
  });

  it('falsy model returns 0 regardless of extras', () => {
    expect(estimateCost(100, 200, null, null, { cache_creation_tokens: 1000, cache_read_tokens: 1000 })).toBe(0);
    expect(estimateCost(100, 200, '', null, { cache_creation_tokens: 1000, cache_read_tokens: 1000 })).toBe(0);
  });
});

describe('billing.estimateCost — 5-arg cache extras', () => {
  it('opus-4-7 adds cache_creation @ 6.25/M and cache_read @ 0.50/M', () => {
    // Opus 4.5/4.6/4.7 family rates per Anthropic pricing docs:
    // input $5/M, output $25/M, cache_write $6.25/M, cache_read $0.50/M.
    const base = estimateCost(100, 200, 'claude-opus-4-7');
    // 100*5/1M + 200*25/1M = 0.0005 + 0.005 = 0.0055
    expect(Math.abs(base - 0.0055)).toBeLessThan(1e-9);
    const cost = estimateCost(100, 200, 'claude-opus-4-7', null, {
      cache_creation_tokens: 10000,
      cache_read_tokens: 100000,
    });
    // base + (10000 * 6.25 + 100000 * 0.50)/1M = 0.0055 + (62500 + 50000)/1M = 0.0055 + 0.1125
    expect(Math.abs(cost - (0.0055 + 0.1125))).toBeLessThan(1e-9);
  });

  it('sonnet-4-6 adds cache_creation @ 3.75/M and cache_read @ 0.30/M', () => {
    const base = estimateCost(100, 200, 'claude-sonnet-4-6');
    // 100*3/1M + 200*15/1M = 0.0003 + 0.003 = 0.0033
    expect(Math.abs(base - 0.0033)).toBeLessThan(1e-9);
    const cost = estimateCost(100, 200, 'claude-sonnet-4-6', null, {
      cache_creation_tokens: 10000,
      cache_read_tokens: 100000,
    });
    // base + (10000 * 3.75 + 100000 * 0.30)/1M = 0.0033 + (37500 + 30000)/1M
    expect(Math.abs(cost - (0.0033 + 0.0675))).toBeLessThan(1e-9);
  });

  it('haiku-4-5 adds cache_creation @ 1.25/M and cache_read @ 0.10/M', () => {
    const cost = estimateCost(100, 200, 'claude-haiku-4-5', null, {
      cache_creation_tokens: 10000,
      cache_read_tokens: 100000,
    });
    const base = estimateCost(100, 200, 'claude-haiku-4-5');
    // base + (10000 * 1.25 + 100000 * 0.10)/1M = base + (12500 + 10000)/1M
    expect(Math.abs(cost - base - 0.0225)).toBeLessThan(1e-9);
  });

  it('model without cache columns (codex) returns same as 4-arg even with extras supplied', () => {
    // gpt-4o gained cache_read pricing in the LiteLLM-driven refresh; use a
    // model that still has no cache columns to lock in the "extras ignored
    // when columns absent" contract. Codex is hand-curated and intentionally
    // stays cache-less because Anthropic-style cache pricing doesn't apply.
    const base = estimateCost(100, 200, 'codex');
    const withExtras = estimateCost(100, 200, 'codex', null, {
      cache_creation_tokens: 50000,
      cache_read_tokens: 50000,
    });
    expect(withExtras).toBe(base);
  });

  it('custom pricing without cache columns ignores extras safely', () => {
    const custom = [{ pattern: 'custom-model', input: 5, output: 25 }];
    const base = estimateCost(100, 200, 'custom-model', custom);
    const withExtras = estimateCost(100, 200, 'custom-model', custom, {
      cache_creation_tokens: 1000,
      cache_read_tokens: 1000,
    });
    expect(withExtras).toBe(base);
  });

  it('custom pricing with cache columns honours them', () => {
    const custom = [{ pattern: 'custom-cache-model', input: 2, output: 10, cache_write: 4, cache_read: 0.5 }];
    const cost = estimateCost(100, 200, 'custom-cache-model', custom, {
      cache_creation_tokens: 1000000,
      cache_read_tokens: 1000000,
    });
    // base = 100*2/1M + 200*10/1M = 0.0002 + 0.002 = 0.0022
    // extras = 1000000*4/1M + 1000000*0.5/1M = 4 + 0.5 = 4.5
    expect(Math.abs(cost - (0.0022 + 4.5))).toBeLessThan(1e-9);
  });
});
