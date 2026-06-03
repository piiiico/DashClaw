import { describe, it, expect } from 'vitest';
import { parseGeneratedPolicies } from '@/lib/policy-generator.js';

describe('parseGeneratedPolicies — structured {drafts, assumptions, clarifications}', () => {
  it('keeps valid drafts and passes through assumptions + clarifications', () => {
    const raw = JSON.stringify({
      drafts: [{ name: 'Protect secrets', policy_type: 'protected_path', rules: { paths: ['.env', 'secrets/'], action: 'block' }, confidence: 0.9 }],
      assumptions: ['Assumed protected paths from common sensitive locations'],
      clarifications: [{ id: 'action', question: 'How strict?', field: 'rules.action', suggestions: ['warn', 'block', 'require approval'], multi: false }],
    });
    const out = parseGeneratedPolicies(raw);
    expect(out.drafts).toHaveLength(1);
    expect(out.drafts[0].policy_type).toBe('protected_path');
    expect(out.assumptions[0]).toMatch(/Assumed/);
    expect(out.clarifications[0].id).toBe('action');
    expect(out.warnings).toEqual([]);
  });

  it('drops an invalid draft into warnings but keeps the response usable', () => {
    const raw = JSON.stringify({ drafts: [{ name: '', policy_type: 'not_a_type', rules: {} }], assumptions: [], clarifications: [] });
    const out = parseGeneratedPolicies(raw);
    expect(out.drafts).toHaveLength(0);
    expect(out.warnings.length).toBeGreaterThan(0);
    // never dead-ends: with no drafts and no clarifications, one is synthesized
    expect(out.clarifications.length).toBeGreaterThan(0);
  });

  it('never dead-ends on a JSON parse failure', () => {
    const out = parseGeneratedPolicies('not json at all');
    expect(out.drafts).toEqual([]);
    expect(out.clarifications.length).toBeGreaterThan(0);
  });

  it('accepts a bare array as drafts (back-compat)', () => {
    const raw = JSON.stringify([{ name: 'Block deploys', policy_type: 'block_action_type', rules: { action_types: ['deploy'] } }]);
    const out = parseGeneratedPolicies(raw);
    expect(out.drafts).toHaveLength(1);
  });
});
