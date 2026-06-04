import { describe, expect, it } from 'vitest';
import {
  buildPolicySummary,
  compilePolicyPayload,
  createDefaultPolicyFormState,
  decompilePolicyForm,
} from '../../app/policies/lib/policyFormModel.js';
import { inferPolicyType } from '../../app/lib/policyPackPreviews.js';

describe('policyFormModel', () => {
  it('creates valid default manual authoring state', () => {
    const state = createDefaultPolicyFormState();

    expect(state.name).toBe('');
    expect(state.type).toBe('risk_threshold');
    expect(state.threshold).toBe(80);
    expect(state.action).toBe('block');
    expect(state.agentIds).toEqual([]);
  });

  it('compiles risk threshold form state into the current route payload', () => {
    const payload = compilePolicyPayload({
      name: 'Block high risk deploys',
      type: 'risk_threshold',
      threshold: 90,
      action: 'block',
      agentIds: ['agt_1', 'agt_2'],
    });

    expect(payload).toEqual({
      name: 'Block high risk deploys',
      policy_type: 'risk_threshold',
      rules: JSON.stringify({
        threshold: 90,
        action: 'block',
      }),
      agent_ids: JSON.stringify(['agt_1', 'agt_2']),
    });
  });

  it('compiles semantic check state into the current route payload', () => {
    const payload = compilePolicyPayload({
      name: 'Protect system files',
      type: 'semantic_check',
      instruction: 'Do not allow the agent to delete files in /system.',
      fallback: 'allow',
      agentIds: [],
    });

    expect(payload).toEqual({
      name: 'Protect system files',
      policy_type: 'semantic_check',
      rules: JSON.stringify({
        instruction: 'Do not allow the agent to delete files in /system.',
        fallback: 'allow',
      }),
      agent_ids: null,
    });
  });

  it('compiles non_fabrication state into the route payload', () => {
    const payload = compilePolicyPayload({
      name: 'No fabricated facts',
      type: 'non_fabrication',
      actionTypes: ['message'],
      onViolation: 'require_approval',
      contentPath: 'content',
      sourcePath: 'source_of_truth',
      agentIds: [],
    });

    expect(payload).toEqual({
      name: 'No fabricated facts',
      policy_type: 'non_fabrication',
      rules: JSON.stringify({
        action_types: ['message'],
        content_path: 'content',
        source_path: 'source_of_truth',
        on_violation: 'require_approval',
      }),
      agent_ids: null,
    });
  });

  it('omits action_types from non_fabrication rules when none are selected (applies to all)', () => {
    const payload = compilePolicyPayload({ name: 'NF all', type: 'non_fabrication', actionTypes: [], agentIds: [] });
    expect(JSON.parse(payload.rules)).toEqual({
      content_path: 'content',
      source_path: 'source_of_truth',
      on_violation: 'block',
    });
  });

  it('round-trips a non_fabrication policy through decompile', () => {
    const form = decompilePolicyForm({
      name: 'NF',
      policy_type: 'non_fabrication',
      rules: JSON.stringify({ action_types: ['message'], content_path: 'body', source_path: 'facts', on_violation: 'block' }),
      agent_ids: null,
    });
    expect(form.type).toBe('non_fabrication');
    expect(form.actionTypes).toEqual(['message']);
    expect(form.contentPath).toBe('body');
    expect(form.sourcePath).toBe('facts');
    expect(form.onViolation).toBe('block');
  });

  it('summarizes a non_fabrication policy', () => {
    expect(
      buildPolicySummary({ type: 'non_fabrication', actionTypes: ['message'], onViolation: 'block', agentIds: [] })
    ).toMatch(/source-of-truth/i);
    // applies-to-all reads cleanly (no doubled "selected actions actions")
    const all = buildPolicySummary({ type: 'non_fabrication', actionTypes: [], onViolation: 'require_approval', agentIds: [] });
    expect(all).toContain('any action');
    expect(all).not.toContain('selected actions actions');
  });

  it('decompiles persisted policy into type-specific form state', () => {
    const form = decompilePolicyForm({
      id: 'gp_1',
      name: 'Require deploy approval',
      policy_type: 'require_approval',
      rules: JSON.stringify({
        action_types: ['deploy', 'security'],
        action: 'require_approval',
      }),
      agent_ids: JSON.stringify(['agt_9']),
    });

    expect(form.name).toBe('Require deploy approval');
    expect(form.type).toBe('require_approval');
    expect(form.actionTypes).toEqual(['deploy', 'security']);
    expect(form.agentIds).toEqual(['agt_9']);
  });

  it('builds readable summaries for each supported policy type', () => {
    expect(
      buildPolicySummary({
        type: 'risk_threshold',
        threshold: 80,
        action: 'block',
        agentIds: [],
      })
    ).toContain('Block actions when risk is 80 or higher');

    expect(
      buildPolicySummary({
        type: 'require_approval',
        actionTypes: ['deploy', 'security'],
        agentIds: [],
      })
    ).toContain('Require approval for deploy and security actions');

    expect(
      buildPolicySummary({
        type: 'block_action_type',
        actionTypes: ['cleanup'],
        agentIds: [],
      })
    ).toContain('Block cleanup actions entirely');

    expect(
      buildPolicySummary({
        type: 'rate_limit',
        maxActions: 50,
        windowMinutes: 60,
        action: 'warn',
        agentIds: [],
      })
    ).toContain('Warn when an agent exceeds 50 actions in 60 minutes');

    expect(
      buildPolicySummary({
        type: 'webhook_check',
        webhookUrl: 'https://guard.example.com/check',
        webhookTimeout: 5000,
        webhookOnTimeout: 'allow',
        agentIds: [],
      })
    ).toContain('guard.example.com');

    expect(
      buildPolicySummary({
        type: 'semantic_check',
        instruction: 'Do not allow deletion of system files.',
        fallback: 'allow',
        agentIds: [],
      })
    ).toContain('Do not allow deletion of system files');
  });
});

describe('custom action types — form output matches Import on the guard-matched fields', () => {
  it('compiles a typed custom action type into the same policy_type + rules.action_types as importing the YAML', () => {
    // Form: name "Marketplace Publish Requires Approval", type require_approval,
    // action type `marketplace_publish` (typed in the free-text input, not a preset).
    const formPayload = compilePolicyPayload({
      name: 'Marketplace Publish Requires Approval',
      type: 'require_approval',
      actionTypes: ['marketplace_publish'],
      agentIds: [],
    });

    // The equivalent imported policy, as app/api/policies/import/route.js compiles
    // it from the YAML:
    //   applies_to: { tools: [marketplace_publish] }
    //   rule: { require: approval }
    const importedPolicy = {
      id: 'ps_marketplace_publish_requires_approval',
      applies_to: { tools: ['marketplace_publish'] },
      rule: { require: 'approval' },
    };
    const importedPolicyType = inferPolicyType(importedPolicy);
    const importedRules = {
      action_types: importedPolicy.applies_to?.tools || [],
      ...(importedPolicy.rule || {}),
      tests: importedPolicy.tests || [],
    };

    // policy_type is identical — both resolve to require_approval.
    expect(formPayload.policy_type).toBe('require_approval');
    expect(importedPolicyType).toBe('require_approval');
    expect(formPayload.policy_type).toBe(importedPolicyType);

    // rules.action_types is the ONLY field the require_approval guard matches on
    // (app/lib/guard.js: `actionTypes.includes(context.action_type)`), so this is
    // the byte-for-byte-relevant field — identical for form and import.
    const formRules = JSON.parse(formPayload.rules);
    expect(formRules.action_types).toEqual(['marketplace_publish']);
    expect(formRules.action_types).toEqual(importedRules.action_types);
  });

  it('summarizes a typed custom action type the same way as a preset', () => {
    expect(
      buildPolicySummary({ type: 'require_approval', actionTypes: ['marketplace_publish'], agentIds: [] })
    ).toContain('Require approval for marketplace_publish actions');
  });
});
