import { describe, expect, it } from 'vitest';
import { gapToPolicyDraft } from '../../app/lib/compliance/gap-to-policy.js';

describe('gapToPolicyDraft (A6)', () => {
  it('produces a valid block_action_type draft for a block control', () => {
    const draft = gapToPolicyDraft({
      control_id: 'CC6.1',
      status: 'gap',
      policy_mappings: [{ policy_pattern: 'block', tool_patterns: ['exec', 'file.delete'], coverage: 'full' }],
    });
    expect(draft).not.toBeNull();
    expect(draft.policy_type).toBe('block_action_type');
    expect(draft.rules.action_types).toEqual(['exec', 'file.delete']);
    expect(draft.rules.action).toBe('block');
  });

  it('produces a require_approval draft from tool patterns', () => {
    const draft = gapToPolicyDraft({
      control_id: 'CC7.1',
      policy_mappings: [{ policy_pattern: 'require_approval', tool_patterns: ['deploy'] }],
    });
    expect(draft.policy_type).toBe('require_approval');
    expect(draft.rules.action_types).toEqual(['deploy']);
    expect(draft.rules.action).toBe('require_approval');
  });

  it('produces a risk_threshold draft with no tool patterns needed', () => {
    const draft = gapToPolicyDraft({ control_id: 'X', policy_mappings: [{ policy_pattern: 'risk_threshold' }] });
    expect(draft.policy_type).toBe('risk_threshold');
    expect(draft.rules.threshold).toBe(80);
  });

  it('returns null for a free-text-only control (no recognized mappings)', () => {
    expect(gapToPolicyDraft({
      control_id: 'Y',
      status: 'gap',
      gap_recommendations: ['Document a manual incident-response runbook'],
      policy_mappings: [],
    })).toBeNull();
    expect(gapToPolicyDraft({ control_id: 'Z', policy_mappings: [{ policy_pattern: 'any_active_policy' }] })).toBeNull();
  });

  it('returns null for a block mapping with no concrete tool patterns', () => {
    expect(gapToPolicyDraft({ control_id: 'W', policy_mappings: [{ policy_pattern: 'block', tool_patterns: ['*'] }] })).toBeNull();
  });

  it('returns null for a non-object input', () => {
    expect(gapToPolicyDraft(null)).toBeNull();
    expect(gapToPolicyDraft(undefined)).toBeNull();
  });
});
