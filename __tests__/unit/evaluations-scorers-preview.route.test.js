import { describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

// Force the no-provider branch deterministically. Without this the test env may
// have a real OPENAI_API_KEY and llm_judge would issue a live network call.
vi.mock('@/lib/llm.js', () => ({
  isLLMAvailable: () => false,
  tryLLMComplete: async () => ({ result: null, error: 'no provider configured' }),
}));

import { POST } from '@/api/evaluations/scorers/preview/route.js';

// The preview route is pure compute (no DB, no org) — it wraps executeScorer
// and must NOT persist anything. These tests assert real scores, label/score
// math, validation failures, and the engine's error paths.

function post(body) {
  return POST(makeRequest('http://localhost/api/evaluations/scorers/preview', { body }));
}

describe('POST /api/evaluations/scorers/preview', () => {
  it('scores numeric_range in-range as 1.0', async () => {
    const res = await post({
      scorer_type: 'numeric_range',
      config: { field: 'risk_score', min: 0, max: 50 },
      sample: { risk_score: 20 },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.preview).toBe(true);
    expect(data.result.score).toBe(1);
    expect(data.result.label).toBe('in_range');
    expect(data.result.error).toBeNull();
  });

  it('scores numeric_range out-of-range as 0.0', async () => {
    const res = await post({
      scorer_type: 'numeric_range',
      config: { field: 'risk_score', min: 0, max: 50 },
      sample: { risk_score: 90 },
    });
    const data = await res.json();
    expect(data.result.score).toBe(0);
    expect(data.result.label).toBe('out_of_range');
  });

  it('scores a contains match and reports the found keyword', async () => {
    const res = await post({
      scorer_type: 'contains',
      config: { keywords: ['tests pass', 'green'], mode: 'any' },
      sample: { outcome: 'all tests pass on main' },
    });
    const data = await res.json();
    expect(data.result.score).toBe(1);
    expect(data.result.label).toBe('contains');
    expect(data.result.reasoning).toMatch(/tests pass/);
  });

  it('scores a contains miss as 0.0', async () => {
    const res = await post({
      scorer_type: 'contains',
      config: { keywords: ['deployed'], mode: 'all' },
      sample: { outcome: 'work in progress' },
    });
    const data = await res.json();
    expect(data.result.score).toBe(0);
    expect(data.result.label).toBe('missing');
  });

  it('evaluates a custom_function expression and clamps to 0..1', async () => {
    const res = await post({
      scorer_type: 'custom_function',
      config: { expression: 'status === "completed" ? 1 : 0' },
      sample: { status: 'completed' },
    });
    const data = await res.json();
    expect(data.result.score).toBe(1);
    expect(data.result.label).toBe('pass');
  });

  it('rejects a missing scorer_type with 400', async () => {
    const res = await post({ config: {}, sample: {} });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/scorer_type is required/);
  });

  it('rejects an unknown scorer_type with 400', async () => {
    const res = await post({ scorer_type: 'magic', config: {} });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/must be one of/);
  });

  it('rejects a non-object sample with 400', async () => {
    const res = await post({ scorer_type: 'contains', config: {}, sample: 'nope' });
    expect(res.status).toBe(400);
  });

  it('surfaces engine errors in result.error (still 200) for a bad regex', async () => {
    const res = await post({
      scorer_type: 'regex',
      // Unterminated group → RegExp construction throws inside the vm.
      config: { pattern: '(' },
      sample: { outcome: 'anything' },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.score).toBeNull();
    expect(data.result.error).toMatch(/Regex error/);
  });

  it('llm_judge without a configured provider returns a structured error, not a throw', async () => {
    const res = await post({
      scorer_type: 'llm_judge',
      config: {},
      sample: { outcome: 'done', status: 'completed' },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.score).toBeNull();
    expect(data.result.error).toMatch(/provider not configured|AI provider/i);
  });
});
