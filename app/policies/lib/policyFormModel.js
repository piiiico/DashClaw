const DEFAULT_FORM_STATE = {
  name: '',
  type: 'risk_threshold',
  action: 'block',
  threshold: 80,
  actionTypes: [],
  maxActions: 50,
  windowMinutes: 60,
  webhookUrl: '',
  webhookTimeout: 5000,
  webhookOnTimeout: 'allow',
  instruction: '',
  fallback: 'allow',
  // non_fabrication
  contentPath: 'content',
  sourcePath: 'source_of_truth',
  onViolation: 'block',
  agentIds: [],
};

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseAgentIds(policy) {
  if (!policy?.agent_ids) return [];
  try {
    const parsed = JSON.parse(policy.agent_ids);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseRules(policy) {
  try {
    return JSON.parse(policy?.rules || policy?.config || '{}');
  } catch {
    return {};
  }
}

function actionListText(actionTypes = []) {
  const cleaned = Array.isArray(actionTypes)
    ? actionTypes.map((type) => cleanString(type)).filter(Boolean)
    : [];

  if (cleaned.length === 0) return 'selected actions';
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned.at(-1)}`;
}

function scopeText(agentIds = []) {
  return Array.isArray(agentIds) && agentIds.length > 0
    ? ` for ${agentIds.length} selected agent${agentIds.length === 1 ? '' : 's'}`
    : '';
}

export function createDefaultPolicyFormState() {
  return JSON.parse(JSON.stringify(DEFAULT_FORM_STATE));
}

export function compilePolicyPayload(formState) {
  const form = {
    ...createDefaultPolicyFormState(),
    ...formState,
  };

  let rules;

  switch (form.type) {
    case 'risk_threshold':
      rules = { threshold: Number(form.threshold) || 0, action: form.action };
      break;
    case 'require_approval':
      rules = { action_types: form.actionTypes || [], action: 'require_approval' };
      break;
    case 'block_action_type':
      rules = { action_types: form.actionTypes || [], action: 'block' };
      break;
    case 'rate_limit':
      rules = {
        max_actions: Number(form.maxActions) || 1,
        window_minutes: Number(form.windowMinutes) || 1,
        action: form.action,
      };
      break;
    case 'webhook_check':
      rules = {
        url: cleanString(form.webhookUrl),
        timeout_ms: Number(form.webhookTimeout) || 5000,
        on_timeout: form.webhookOnTimeout || 'allow',
      };
      break;
    case 'semantic_check':
      rules = {
        instruction: cleanString(form.instruction),
        fallback: form.fallback || 'allow',
      };
      break;
    case 'non_fabrication':
      rules = {
        ...(Array.isArray(form.actionTypes) && form.actionTypes.length > 0
          ? { action_types: form.actionTypes }
          : {}),
        content_path: cleanString(form.contentPath) || 'content',
        source_path: cleanString(form.sourcePath) || 'source_of_truth',
        on_violation: form.onViolation === 'require_approval' ? 'require_approval' : 'block',
      };
      break;
    default:
      rules = {};
      break;
  }

  return {
    name: cleanString(form.name),
    policy_type: form.type,
    rules: JSON.stringify(rules),
    agent_ids: Array.isArray(form.agentIds) && form.agentIds.length > 0
      ? JSON.stringify(form.agentIds)
      : null,
  };
}

export function decompilePolicyForm(policy) {
  const rules = parseRules(policy);
  const policyType = policy?.policy_type || policy?.type || DEFAULT_FORM_STATE.type;

  return {
    ...createDefaultPolicyFormState(),
    name: cleanString(policy?.name),
    type: policyType,
    action: rules.action || 'block',
    threshold: rules.threshold ?? DEFAULT_FORM_STATE.threshold,
    actionTypes: Array.isArray(rules.action_types) ? rules.action_types : [],
    maxActions: rules.max_actions || DEFAULT_FORM_STATE.maxActions,
    windowMinutes: rules.window_minutes || DEFAULT_FORM_STATE.windowMinutes,
    webhookUrl: rules.url || '',
    webhookTimeout: rules.timeout_ms || DEFAULT_FORM_STATE.webhookTimeout,
    webhookOnTimeout: rules.on_timeout || DEFAULT_FORM_STATE.webhookOnTimeout,
    instruction: rules.instruction || '',
    fallback: rules.fallback || DEFAULT_FORM_STATE.fallback,
    contentPath: rules.content_path || DEFAULT_FORM_STATE.contentPath,
    sourcePath: rules.source_path || DEFAULT_FORM_STATE.sourcePath,
    onViolation: rules.on_violation || DEFAULT_FORM_STATE.onViolation,
    agentIds: parseAgentIds(policy),
  };
}

export function buildPolicySummary(formState) {
  const form = {
    ...createDefaultPolicyFormState(),
    ...formState,
  };
  const scoped = scopeText(form.agentIds);

  switch (form.type) {
    case 'risk_threshold':
      return `${form.action === 'block' ? 'Block' : form.action === 'warn' ? 'Warn on' : 'Require approval for'} actions when risk is ${Number(form.threshold) || 0} or higher${scoped}.`;
    case 'require_approval':
      return `Require approval for ${actionListText(form.actionTypes)} actions${scoped}.`;
    case 'block_action_type':
      return `Block ${actionListText(form.actionTypes)} actions entirely${scoped}.`;
    case 'rate_limit':
      return `${form.action === 'block' ? 'Block' : form.action === 'warn' ? 'Warn when' : 'Require approval when'} an agent exceeds ${Number(form.maxActions) || 1} actions in ${Number(form.windowMinutes) || 1} minutes${scoped}.`;
    case 'webhook_check': {
      let host = cleanString(form.webhookUrl);
      try {
        host = new URL(form.webhookUrl).hostname;
      } catch {
        // keep raw string
      }
      return `Call ${host || 'the configured webhook'} before allowing the action. If the webhook times out, ${form.webhookOnTimeout || 'allow'} the action${scoped}.`;
    }
    case 'semantic_check':
      return `Use a semantic check to evaluate whether the action violates the instruction: "${cleanString(form.instruction)}"${scoped}.`;
    case 'non_fabrication': {
      const nfScope = Array.isArray(form.actionTypes) && form.actionTypes.length > 0
        ? `${actionListText(form.actionTypes)} actions`
        : 'any action';
      return `${form.onViolation === 'require_approval' ? 'Require approval for' : 'Block'} ${nfScope} whose outbound content states a fact not traceable to its source-of-truth${scoped}.`;
    }
    default:
      return 'Configure a policy rule.';
  }
}
