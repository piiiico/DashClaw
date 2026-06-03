import { buildPolicySummary, createDefaultPolicyFormState } from './policyFormModel.js';

const CORE_TOP_LEVEL_KEYS = new Set(['name', 'policy_type', 'rules', 'confidence']);
const RISK_THRESHOLD_RULE_KEYS = new Set(['threshold', 'action']);
const REQUIRE_APPROVAL_RULE_KEYS = new Set(['action_types', 'action']);

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

function collectAdvancedDetails(generatedPolicy, supportedRuleKeys) {
  const advancedDetails = {};
  const rules = generatedPolicy?.rules && typeof generatedPolicy.rules === 'object' ? generatedPolicy.rules : {};

  const unsupportedTopLevel = Object.fromEntries(
    Object.entries(generatedPolicy || {}).filter(([key]) => !CORE_TOP_LEVEL_KEYS.has(key))
  );
  if (Object.keys(unsupportedTopLevel).length > 0) {
    Object.assign(advancedDetails, unsupportedTopLevel);
  }

  const unsupportedRules = Object.fromEntries(
    Object.entries(rules).filter(([key]) => !supportedRuleKeys.has(key))
  );
  if (Object.keys(unsupportedRules).length > 0) {
    advancedDetails.rules = unsupportedRules;
  }

  return Object.keys(advancedDetails).length > 0 ? advancedDetails : null;
}

function normalizeRiskThresholdDraft(generatedPolicy) {
  const rules = generatedPolicy?.rules && typeof generatedPolicy.rules === 'object' ? generatedPolicy.rules : {};
  const formState = {
    ...createDefaultPolicyFormState(),
    name: cleanString(generatedPolicy?.name),
    type: 'risk_threshold',
    threshold: toNumber(rules.threshold, 0),
    action: cleanString(rules.action) || 'block',
  };

  return {
    formState,
    advancedDetails: collectAdvancedDetails(generatedPolicy, RISK_THRESHOLD_RULE_KEYS),
  };
}

function normalizeRequireApprovalDraft(generatedPolicy) {
  const rules = generatedPolicy?.rules && typeof generatedPolicy.rules === 'object' ? generatedPolicy.rules : {};
  const formState = {
    ...createDefaultPolicyFormState(),
    name: cleanString(generatedPolicy?.name),
    type: 'require_approval',
    actionTypes: normalizeArray(rules.action_types),
    action: cleanString(rules.action) || 'require_approval',
  };

  return {
    formState,
    advancedDetails: collectAdvancedDetails(generatedPolicy, REQUIRE_APPROVAL_RULE_KEYS),
  };
}

export function normalizeGeneratedPolicyDraft(generatedPolicy, index = 0) {
  const policyType = generatedPolicy?.policy_type || generatedPolicy?.type || 'risk_threshold';
  const normalizer = policyType === 'require_approval'
    ? normalizeRequireApprovalDraft
    : normalizeRiskThresholdDraft;

  const { formState, advancedDetails } = normalizer(generatedPolicy);

  return {
    id: `generated-${index}`,
    name: formState.name,
    confidence: typeof generatedPolicy?.confidence === 'number' ? generatedPolicy.confidence : null,
    formState,
    summary: buildPolicySummary(formState),
    hasAdvancedDetails: advancedDetails !== null,
    advancedDetails,
    rawPolicy: generatedPolicy,
  };
}

export function normalizeGeneratedPolicyDrafts(generatedPolicies) {
  if (!Array.isArray(generatedPolicies)) return [];

  return generatedPolicies.map((generatedPolicy, index) => normalizeGeneratedPolicyDraft(generatedPolicy, index));
}
