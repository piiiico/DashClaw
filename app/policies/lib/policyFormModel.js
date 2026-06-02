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
  // behavioral_anomaly
  similarityThreshold: 0.75,
  minHistory: 5,
  // permission_escalation
  enforce: true,
  // green_contract
  requiredLevel: 'workspace',
  // branch_freshness
  freshness: ['stale', 'diverged'],
  maxCommitsBehind: 0,
  // protected_path (Behavior Learning)
  protectedPaths: [],
  agentIds: [],
};

// Single source of truth for the policy-type picker (label + one-line
// description), shared by the manual authoring panel and the generated-draft
// editor so both expose every backend-enforced type. Mirrors the canonical
// POLICY_TYPES list in app/lib/validate.js.
export const POLICY_TYPE_OPTIONS = [
  { value: 'risk_threshold', label: 'Risk Threshold', desc: 'Block or warn when risk score exceeds a threshold' },
  { value: 'require_approval', label: 'Require Approval', desc: 'Require approval for specific action types' },
  { value: 'block_action_type', label: 'Block Action Type', desc: 'Block specific action types entirely' },
  { value: 'rate_limit', label: 'Rate Limit', desc: 'Warn or block when an agent exceeds action frequency' },
  { value: 'webhook_check', label: 'Webhook Check', desc: 'Call an external endpoint for custom decision logic' },
  { value: 'semantic_check', label: 'Semantic Check', desc: 'Use an LLM to evaluate action intent against natural-language rules' },
  { value: 'behavioral_anomaly', label: 'Behavioral Anomaly', desc: 'Flag actions unlike the agent’s recent behavior (embedding similarity). Requires an OpenAI key.' },
  { value: 'permission_escalation', label: 'Permission Escalation', desc: 'Block actions whose required tool permission exceeds the agent’s approved pairing level' },
  { value: 'green_contract', label: 'Green Contract', desc: 'Gate actions (e.g. deploy) until tests reach a required green level' },
  { value: 'branch_freshness', label: 'Branch Freshness', desc: 'Block actions when the branch is stale/diverged or too many commits behind' },
  { value: 'non_fabrication', label: 'Non-Fabrication', desc: 'Block or route to approval outbound content that states a fact not traceable to its source-of-truth' },
  { value: 'protected_path', label: 'Protected Path', desc: 'Warn or require approval when an action touches sensitive paths (auth, secrets, billing, middleware, …)' },
];

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
    case 'behavioral_anomaly':
      rules = {
        similarity_threshold: Math.max(0, Math.min(1, Number(form.similarityThreshold) || 0)),
        min_history: Math.max(1, Number(form.minHistory) || 5),
        action: form.action,
      };
      break;
    case 'permission_escalation':
      rules = { enforce: !!form.enforce, action: form.action };
      break;
    case 'green_contract':
      rules = {
        action_types: form.actionTypes || [],
        required_level: form.requiredLevel || 'workspace',
        action: form.action,
      };
      break;
    case 'branch_freshness':
      rules = {
        action_types: form.actionTypes || [],
        freshness: Array.isArray(form.freshness) && form.freshness.length > 0
          ? form.freshness
          : ['stale', 'diverged'],
        max_commits_behind: Math.max(0, Number(form.maxCommitsBehind) || 0),
        action: form.action,
      };
      break;
    case 'protected_path':
      rules = {
        paths: Array.isArray(form.protectedPaths)
          ? form.protectedPaths.map((p) => cleanString(p)).filter(Boolean)
          : [],
        action: form.action === 'block' || form.action === 'warn' ? form.action : 'require_approval',
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
    similarityThreshold: rules.similarity_threshold ?? DEFAULT_FORM_STATE.similarityThreshold,
    minHistory: rules.min_history ?? DEFAULT_FORM_STATE.minHistory,
    enforce: rules.enforce !== undefined ? !!rules.enforce : DEFAULT_FORM_STATE.enforce,
    requiredLevel: rules.required_level || DEFAULT_FORM_STATE.requiredLevel,
    freshness: Array.isArray(rules.freshness) ? rules.freshness : DEFAULT_FORM_STATE.freshness,
    maxCommitsBehind: rules.max_commits_behind ?? DEFAULT_FORM_STATE.maxCommitsBehind,
    protectedPaths: Array.isArray(rules.paths) ? rules.paths : DEFAULT_FORM_STATE.protectedPaths,
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
    case 'behavioral_anomaly': {
      const pct = Math.round((Number(form.similarityThreshold) || 0) * 100);
      const verb = form.action === 'block' ? 'Block' : form.action === 'warn' ? 'Warn on' : 'Require approval for';
      return `${verb} actions less than ${pct}% similar to the agent’s recent behavior, after ${Number(form.minHistory) || 5} baseline samples${scoped}. Requires embeddings (OpenAI key).`;
    }
    case 'permission_escalation':
      return form.enforce
        ? `${form.action === 'block' ? 'Block' : form.action === 'warn' ? 'Warn on' : 'Require approval for'} actions whose required tool permission exceeds the agent’s approved pairing level${scoped}.`
        : `Permission-escalation policy is configured but disabled — set Enforce to activate it${scoped}.`;
    case 'green_contract': {
      const verb = form.action === 'block' ? 'Block' : form.action === 'warn' ? 'Warn on' : 'Require approval for';
      return `${verb} ${actionListText(form.actionTypes)} actions unless test status has reached “${form.requiredLevel || 'workspace'}”${scoped}.`;
    }
    case 'branch_freshness': {
      const verb = form.action === 'block' ? 'Block' : form.action === 'warn' ? 'Warn on' : 'Require approval for';
      const states = (Array.isArray(form.freshness) ? form.freshness : ['stale', 'diverged']).join(' or ');
      return `${verb} ${actionListText(form.actionTypes)} actions when the branch is ${states} and more than ${Number(form.maxCommitsBehind) || 0} commits behind${scoped}.`;
    }
    case 'protected_path': {
      const verb = form.action === 'block' ? 'Block' : form.action === 'warn' ? 'Warn on' : 'Require approval for';
      const count = Array.isArray(form.protectedPaths) ? form.protectedPaths.filter(Boolean).length : 0;
      return `${verb} actions that touch ${count > 0 ? `${count} protected path pattern${count === 1 ? '' : 's'}` : 'protected paths'}${scoped}.`;
    }
    default:
      return 'Configure a policy rule.';
  }
}
