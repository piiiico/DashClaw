import { describe, it, expect } from 'vitest';
import { validatePolicy, validateGuardInput, validateActionRecord, POLICY_TYPES } from '../../app/lib/validate.js';

describe('non_fabrication policy validation', () => {
  it('lists non_fabrication as a policy type', () => {
    expect(POLICY_TYPES).toContain('non_fabrication');
  });

  it('accepts a well-formed non_fabrication policy', () => {
    const r = validatePolicy({
      name: 'No fabrication',
      policy_type: 'non_fabrication',
      rules: JSON.stringify({
        action_types: ['message'],
        on_violation: 'require_approval',
        content_path: 'content',
        source_path: 'source_of_truth',
      }),
    });
    expect(r.valid).toBe(true);
  });

  it('accepts minimal rules (defaults applied at evaluation time)', () => {
    const r = validatePolicy({ name: 'nf', policy_type: 'non_fabrication', rules: '{}' });
    expect(r.valid).toBe(true);
  });

  it('rejects an invalid on_violation', () => {
    const r = validatePolicy({ name: 'nf', policy_type: 'non_fabrication', rules: JSON.stringify({ on_violation: 'warn' }) });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/on_violation/);
  });

  it('rejects a non-array action_types', () => {
    const r = validatePolicy({ name: 'nf', policy_type: 'non_fabrication', rules: JSON.stringify({ action_types: 'message' }) });
    expect(r.valid).toBe(false);
  });
});

describe('content + source_of_truth ingestion', () => {
  it('guard input accepts content (string) and source_of_truth (object)', () => {
    const r = validateGuardInput({ action_type: 'message', content: 'hi', source_of_truth: { allowedFacts: [], requiredFacts: [] } });
    expect(r.valid).toBe(true);
    expect(r.data.content).toBe('hi');
    expect(r.data.source_of_truth).toEqual({ allowedFacts: [], requiredFacts: [] });
  });

  it('accepts the camelCase sourceOfTruth alias from the Node SDK', () => {
    const r = validateGuardInput({ action_type: 'message', content: 'hi', sourceOfTruth: { allowedFacts: [], requiredFacts: [] } });
    expect(r.valid).toBe(true);
    expect(r.data.source_of_truth).toEqual({ allowedFacts: [], requiredFacts: [] });
  });

  it('action record accepts content + source_of_truth and forwards them into data', () => {
    const r = validateActionRecord({
      agent_id: 'a1',
      action_type: 'message',
      declared_goal: 'send',
      content: 'hi',
      source_of_truth: { allowedFacts: [], requiredFacts: [] },
    });
    expect(r.valid).toBe(true);
    expect(r.data.content).toBe('hi');
    expect(r.data.source_of_truth).toEqual({ allowedFacts: [], requiredFacts: [] });
  });

  it('rejects a non-object source_of_truth', () => {
    const r = validateGuardInput({ action_type: 'message', content: 'hi', source_of_truth: 'nope' });
    expect(r.valid).toBe(false);
  });
});
