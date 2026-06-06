/**
 * Deterministic mapping from a compliance gap to a prefilled DashClaw policy
 * draft. No LLM. Given a mapped control plus its expected `policy_mappings`
 * (policy_pattern + tool_patterns, as carried on the /api/compliance/map
 * response), it returns a { name, policy_type, rules } draft for the patterns
 * DashClaw can enforce, reusing the suggested_policy shape so the draft can
 * prefill the policy authoring form (decompilePolicyForm).
 *
 * Returns null when the control's expected patterns do not map onto a DashClaw
 * policy type (allowlist, any_active_policy, dry_run, unknown, or a block /
 * require_approval mapping with no concrete tool patterns). Those gaps are
 * handled by the documented manual path (the control's free-text
 * gap_recommendations).
 */

interface PolicyMapping {
  policy_pattern?: unknown;
  tool_patterns?: unknown;
}

interface ComplianceControl {
  policy_mappings?: unknown;
  control_id?: unknown;
  id?: unknown;
}

interface PolicyDraftRules {
  [key: string]: unknown;
}

interface PolicyDraftPartial {
  policy_type: string;
  rules: PolicyDraftRules;
}

interface PolicyDraft {
  name: string;
  policy_type: string;
  rules: PolicyDraftRules;
}

function cleanActionTypes(toolPatterns: unknown): string[] {
  if (!Array.isArray(toolPatterns)) return [];
  return toolPatterns
    .filter((t): t is string => typeof t === 'string' && t.length > 0 && t !== '*')
    .map((t) => t.replace(/\*/g, '').trim())
    .filter(Boolean);
}

function draftForPattern(pattern: unknown, toolPatterns: unknown): PolicyDraftPartial | null {
  switch (pattern) {
    case 'block': {
      const actionTypes = cleanActionTypes(toolPatterns);
      if (actionTypes.length === 0) return null;
      return { policy_type: 'block_action_type', rules: { action_types: actionTypes, action: 'block' } };
    }
    case 'require_approval': {
      const actionTypes = cleanActionTypes(toolPatterns);
      if (actionTypes.length === 0) return null;
      return { policy_type: 'require_approval', rules: { action_types: actionTypes, action: 'require_approval' } };
    }
    case 'rate_limit':
      return { policy_type: 'rate_limit', rules: { max_actions: 100, window_minutes: 60, action: 'warn' } };
    case 'risk_threshold':
      return { policy_type: 'risk_threshold', rules: { threshold: 80, action: 'block' } };
    default:
      // allowlist, any_active_policy, dry_run, and unknown patterns do not map
      // onto a DashClaw policy type for drafting.
      return null;
  }
}

export function gapToPolicyDraft(control: ComplianceControl | null | undefined): PolicyDraft | null {
  if (!control || typeof control !== 'object') return null;
  const mappings: PolicyMapping[] = Array.isArray(control.policy_mappings) ? control.policy_mappings : [];
  for (const mapping of mappings) {
    const draft = draftForPattern(mapping?.policy_pattern, mapping?.tool_patterns);
    if (draft) {
      const label = control.control_id || control.id || 'control';
      return {
        name: `${label}: ${draft.policy_type.replace(/_/g, ' ')}`,
        policy_type: draft.policy_type,
        rules: draft.rules,
      };
    }
  }
  return null;
}
