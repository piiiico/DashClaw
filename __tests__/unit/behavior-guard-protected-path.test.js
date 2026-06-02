import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '@/lib/guard.js';
import { validatePolicy } from '@/lib/validate.js';

// protected_path is a pure path-match policy — no DB access — so evaluatePolicy
// can be exercised directly with a null sql client.
describe('guard protected_path policy', () => {
  const policy = { policy_type: 'protected_path' };

  it('requires approval when the target matches a protected glob', async () => {
    const rules = { paths: ['**/auth/**'], action: 'require_approval' };
    const res = await evaluatePolicy(policy, rules, { target: 'app/api/auth/route.js' }, null, 'org_1');
    expect(res).toBeTruthy();
    expect(res.action).toBe('require_approval');
  });

  it('matches write_paths in the context too', async () => {
    const rules = { paths: ['**/billing/**'], action: 'warn' };
    const res = await evaluatePolicy(policy, rules, { write_paths: ['app/api/billing/route.js'] }, null, 'org_1');
    expect(res.action).toBe('warn');
  });

  it('returns null (no match) for an unprotected path', async () => {
    const rules = { paths: ['**/auth/**'], action: 'require_approval' };
    const res = await evaluatePolicy(policy, rules, { target: 'app/components/Button.jsx' }, null, 'org_1');
    expect(res).toBe(null);
  });

  it('returns null when the policy has no paths', async () => {
    const res = await evaluatePolicy(policy, { paths: [] }, { target: 'anything' }, null, 'org_1');
    expect(res).toBe(null);
  });
});

describe('validate protected_path policy', () => {
  it('accepts a well-formed protected_path policy', () => {
    const r = validatePolicy({
      name: 'auth gate', policy_type: 'protected_path',
      rules: JSON.stringify({ paths: ['**/auth/**'], action: 'require_approval' }),
    });
    expect(r.valid).toBe(true);
  });

  it('rejects a protected_path policy with no paths', () => {
    const r = validatePolicy({
      name: 'bad', policy_type: 'protected_path', rules: JSON.stringify({ paths: [] }),
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/paths/);
  });

  it('rejects an invalid action on a protected_path policy', () => {
    const r = validatePolicy({
      name: 'bad', policy_type: 'protected_path',
      rules: JSON.stringify({ paths: ['**/auth/**'], action: 'nope' }),
    });
    expect(r.valid).toBe(false);
  });
});
