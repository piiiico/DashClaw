import { buildPolicySummary, compilePolicyPayload, decompilePolicyForm } from './policyFormModel.js';

// Top-level keys the draft editor understands natively. Anything else (e.g. a
// model-supplied `recovery_recipe`) is surfaced via advancedDetails for review.
const CORE_TOP_LEVEL_KEYS = new Set(['name', 'policy_type', 'rules', 'confidence', 'agent_ids']);

// Recognized rule keys for a draft = the keys compilePolicyPayload emits for
// that policy type. Any rule key the form model doesn't round-trip is flagged.
function supportedRuleKeysFor(formState) {
  try {
    const compiled = compilePolicyPayload(formState);
    return new Set(Object.keys(JSON.parse(compiled.rules || '{}')));
  } catch {
    return new Set();
  }
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

export function normalizeGeneratedPolicyDraft(generatedPolicy, index = 0) {
  // decompilePolicyForm is the inverse of compilePolicyPayload and maps every
  // policy type's rules into the shared form state (e.g. rules.paths ->
  // protectedPaths). It expects `rules`/`agent_ids` as JSON strings, but a
  // generated draft carries them as objects/arrays — so stringify them.
  const formState = decompilePolicyForm({
    name: generatedPolicy?.name,
    policy_type: generatedPolicy?.policy_type || generatedPolicy?.type,
    rules: JSON.stringify(generatedPolicy?.rules ?? {}),
    agent_ids: generatedPolicy?.agent_ids ? JSON.stringify(generatedPolicy.agent_ids) : null,
  });

  const advancedDetails = collectAdvancedDetails(generatedPolicy, supportedRuleKeysFor(formState));

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
