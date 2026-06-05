import { describe, expect, it } from 'vitest';
import { validateX402Purchase, validatePolicy, POLICY_TYPES } from '@/lib/validate.js';

const base = {
  agent_id: 'a1', provider: 'exa', declared_goal: 'research',
  purchase_reason: 'gap', context_gap: 'no data', expected_value: 'fresh sources',
};

describe('validateX402Purchase (R4)', () => {
  it('accepts a well-formed purchase and surfaces a clean numeric spend_amount', () => {
    const r = validateX402Purchase({ ...base, cost_estimate: 0.05, currency: 'usdc' });
    expect(r.valid).toBe(true);
    expect(r.data.spend_amount).toBe(0.05);
    expect(r.data.currency).toBe('USDC');
  });

  it('rejects missing required rationale fields', () => {
    const r = validateX402Purchase({ agent_id: 'a1', provider: 'exa' });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/declared_goal|purchase_reason|context_gap|expected_value/);
  });

  it('rejects a negative spend amount', () => {
    const r = validateX402Purchase({ ...base, cost_estimate: -5 });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/non-negative/i);
  });

  it('rejects Infinity and NaN spend amounts', () => {
    expect(validateX402Purchase({ ...base, spend_amount: Infinity }).valid).toBe(false);
    expect(validateX402Purchase({ ...base, spend_amount: 'not-a-number' }).valid).toBe(false);
  });

  it('rejects a malformed/oversized currency', () => {
    expect(validateX402Purchase({ ...base, cost_estimate: 1, currency: "'; DROP TABLE x402_purchases; --" }).valid).toBe(false);
  });

  it('rejects an oversized free-text field', () => {
    const r = validateX402Purchase({ ...base, cost_estimate: 1, purchase_reason: 'x'.repeat(5000) });
    expect(r.valid).toBe(false);
  });

  it('rejects a client risk_score outside 0-100', () => {
    expect(validateX402Purchase({ ...base, cost_estimate: 1, risk_score: 9999 }).valid).toBe(false);
  });
});

describe('x402_spend_limit is an authorable policy type (B5)', () => {
  it('POLICY_TYPES includes x402_spend_limit', () => {
    expect(POLICY_TYPES).toContain('x402_spend_limit');
  });

  it('validatePolicy accepts a well-formed x402_spend_limit policy', () => {
    const r = validatePolicy({
      name: 'cap',
      policy_type: 'x402_spend_limit',
      rules: JSON.stringify({ max_spend_usd: 10, approval_threshold: 5, allowed_providers: ['exa'], blocked_providers: [] }),
    });
    expect(r.valid).toBe(true);
  });

  it('validatePolicy rejects x402_spend_limit with a non-numeric max_spend_usd', () => {
    const r = validatePolicy({
      name: 'bad',
      policy_type: 'x402_spend_limit',
      rules: JSON.stringify({ max_spend_usd: 'lots' }),
    });
    expect(r.valid).toBe(false);
  });
});
