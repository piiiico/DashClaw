import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '@/lib/guard.js';

const policy = { policy_type: 'x402_spend_limit' };

describe('evaluatePolicy: x402_spend_limit', () => {
  it('blocks a provider not in the allowed list', async () => {
    const rules = { allowed_providers: ['exa'], approval_threshold: 5, max_spend_usd: 50 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'sketchy', cost_estimate: 0.1 });
    expect(out?.action).toBe('block');
  });

  it('blocks a provider on the blocked list', async () => {
    const rules = { blocked_providers: ['sketchy'], approval_threshold: 5, max_spend_usd: 50 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'sketchy', cost_estimate: 0.1 });
    expect(out?.action).toBe('block');
  });

  it('requires approval over the threshold', async () => {
    const rules = { allowed_providers: [], approval_threshold: 1, max_spend_usd: 50 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'exa', cost_estimate: 2 });
    expect(out?.action).toBe('require_approval');
  });

  it('blocks over the hard max (max takes precedence over approval)', async () => {
    const rules = { allowed_providers: [], approval_threshold: 1, max_spend_usd: 5 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'exa', cost_estimate: 10 });
    expect(out?.action).toBe('block');
  });

  it('allows (returns null) under all limits', async () => {
    const rules = { allowed_providers: ['exa'], approval_threshold: 5, max_spend_usd: 50 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'exa', cost_estimate: 0.1 });
    expect(out).toBeNull();
  });

  it('ignores non-purchase actions', async () => {
    const out = await evaluatePolicy(policy, { max_spend_usd: 0 }, { action_type: 'build', cost_estimate: 999 });
    expect(out).toBeNull();
  });
});
