/**
 * Guard evaluation engine.
 * Evaluates agent context against org policies and returns allow/warn/block/require_approval.
 */

import { randomUUID } from 'node:crypto';
import { deliverGuardWebhook } from './webhooks.js';
import { checkSemanticGuardrail } from './llm.js';
import { generateActionEmbedding, isEmbeddingsEnabled } from './embeddings.js';
import { scanSensitiveData } from './security.js';
import { scanForPromptInjection } from './promptInjection.js';
import { EVENTS, publishOrgEvent } from './events.js';
import { getLearningContext } from './learning-context.js';
import { evaluateRecoveryRecipes } from './recovery.js';

const DECISION_SEVERITY = { allow: 0, warn: 1, require_approval: 2, block: 3 };

const ACTION_TYPE_BASE_SCORES = {
  deploy: 75, security: 80, migrate: 70, apply: 60, sync: 40,
  api: 35, build: 25, fix: 20, refactor: 20, test: 15,
  config: 30, monitor: 10, alert: 10, cleanup: 30, post: 25,
  message: 15, calendar: 10, research: 10, review: 10, other: 20,
};

const HIGH_RISK_SYSTEMS = ['production', 'database', 'postgres', 'neon', 'redis'];
const MODERATE_RISK_SYSTEMS = ['filesystem', 'shell'];
const DESTRUCTIVE_GOAL_PATTERNS = /rm\s+-rf|drop\s+table|delete\s+from|truncate|format|wipe/i;
const DEPLOYMENT_GOAL_PATTERNS = /push|deploy|release|ship|migrate/i;
const SECRET_GOAL_PATTERNS = /secret|credential|password|token|key|\.env/i;

/**
 * Compute an authoritative risk score from structured guard context fields.
 * Returns an integer 0-100.
 *
 * @param {Object} context - guard context object
 * @returns {number}
 */
export function computeRiskScore(context) {
  let score = ACTION_TYPE_BASE_SCORES[context.action_type] ?? ACTION_TYPE_BASE_SCORES.other;

  if (context.reversible === false) score += 15;

  if (Array.isArray(context.systems_touched)) {
    const systems = context.systems_touched.map(s => (typeof s === 'string' ? s.toLowerCase() : ''));
    if (systems.some(s => HIGH_RISK_SYSTEMS.includes(s))) score += 10;
    if (systems.some(s => MODERATE_RISK_SYSTEMS.includes(s))) score += 5;
  }

  if (typeof context.declared_goal === 'string') {
    if (DESTRUCTIVE_GOAL_PATTERNS.test(context.declared_goal)) score += 20;
    if (DEPLOYMENT_GOAL_PATTERNS.test(context.declared_goal)) score += 10;
    if (SECRET_GOAL_PATTERNS.test(context.declared_goal)) score += 15;
  }

  return Math.max(0, Math.min(score, 100));
}

function redactAny(value, findings) {
  if (typeof value === 'string') {
    const scan = scanSensitiveData(value);
    if (!scan.clean) findings.push(...scan.findings);
    return scan.redacted;
  }
  if (Array.isArray(value)) return value.map((v) => redactAny(v, findings));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactAny(v, findings);
    return out;
  }
  return value;
}

/**
 * Evaluate guard policies for an incoming agent action.
 *
 * @param {string} orgId
 * @param {Object} context - { action_type, risk_score, agent_id, systems_touched, reversible, declared_goal }
 * @param {Function} sql - neon sql tagged template
 * @param {Object} [options]
 * @param {boolean} [options.includeSignals=false] - also check live signals (expensive)
 * @param {Function} [options.computeSignals] - computeSignals function (injected to avoid circular deps)
 * @returns {Promise<{ decision, reasons, warnings, matched_policies, risk_score, evaluated_at }>}
 */
export async function evaluateGuard(orgId, context, sql, options = {}) {
  const allPolicies = await sql`
    SELECT id, name, policy_type, rules, agent_ids
    FROM guard_policies
    WHERE org_id = ${orgId} AND active = 1
  `;

  // Filter to policies that apply to this agent (null agent_ids = all agents)
  const currentAgentId = context.agent_id || null;
  const policies = allPolicies.filter(p => {
    if (!p.agent_ids) return true; // null/empty = applies to all
    try {
      const scoped = JSON.parse(p.agent_ids);
      if (!Array.isArray(scoped) || scoped.length === 0) return true;
      return currentAgentId && scoped.includes(currentAgentId);
    } catch (parseErr) {
      console.error('[GUARD] Failed to parse agent_ids for policy:', p.id, parseErr.message);
      return true; // Fail open — applies to all agents when agent_ids is malformed
    }
  });

  // Compute authoritative server-side risk score
  const authoritativeRiskScore = computeRiskScore(context);
  const agentRiskScore = context.risk_score != null ? Number(context.risk_score) : null;
  // Use the higher of computed vs agent-reported (agents may have internal knowledge)
  const effectiveRiskScore = agentRiskScore != null
    ? Math.max(authoritativeRiskScore, Math.max(0, Math.min(agentRiskScore, 100)))
    : authoritativeRiskScore;

  // Predictive risk scoring — statistical analysis of historical behavior
  let predictiveRisk = null;
  try {
    const { getPredictiveRisk } = await import('./predictive-risk.js');
    const { getSettings } = await import('./repositories/settings.repository.js');
    const riskSettings = await getSettings(sql, orgId, { category: 'general' });
    const prEnabled = riskSettings.find(s => s.key === 'PREDICTIVE_RISK_ENABLED')?.value === 'true';
    const prThreshold = parseInt(riskSettings.find(s => s.key === 'PREDICTIVE_RISK_THRESHOLD')?.value, 10) || 60;

    if (context.agent_id && context.action_type) {
      predictiveRisk = await getPredictiveRisk(
        sql, orgId, context.agent_id, context.action_type, effectiveRiskScore,
        { enabled: prEnabled, threshold: prThreshold }
      );
    }
  } catch (e) {
    // Predictive risk is best-effort — never block guard on failure
    console.warn('[Guard] Predictive risk failed:', e.message);
  }

  // Apply statistical adjustment to risk score
  const predictiveAdjustment = predictiveRisk?.total_adjustment ?? 0;
  const adjustedRiskScore = Math.max(0, Math.min(effectiveRiskScore + predictiveAdjustment, 100));

  const reasons = [];
  const warnings = [];
  const matchedPolicies = [];
  let highestDecision = 'allow';

  for (const policy of policies) {
    let rules;
    try {
      rules = JSON.parse(policy.rules);
    } catch {
      continue; // skip malformed
    }

    const result = await evaluatePolicy(policy, rules, context, sql, orgId, adjustedRiskScore);
    if (result) {
      applyResult(result, policy, reasons, warnings, matchedPolicies);
      if (DECISION_SEVERITY[result.action] > DECISION_SEVERITY[highestDecision]) {
        highestDecision = result.action;
      }
    }
  }

  // Default-on prompt injection scanning (opt-out via DISABLE_PROMPT_INJECTION_SCAN=true)
  if (process.env.DISABLE_PROMPT_INJECTION_SCAN !== 'true') {
    const textFields = [context.declared_goal, context.action_type].filter(Boolean);
    for (const text of textFields) {
      const scan = scanForPromptInjection(text);
      if (!scan.clean) {
        const reason = `Prompt injection detected (${scan.risk_level}): ${scan.categories.join(', ')}`;
        if (scan.recommendation === 'block') {
          reasons.push(reason);
          matchedPolicies.push('builtin:prompt_injection_scan');
          if (DECISION_SEVERITY.block > DECISION_SEVERITY[highestDecision]) {
            highestDecision = 'block';
          }
        } else if (scan.recommendation === 'warn') {
          warnings.push(reason);
        }
      }
    }
  }

  // Process webhook_check policies (after local policies, so preliminary decision is known)
  // Snapshot the preliminary state so all webhooks see the same baseline
  const webhookPolicies = policies.filter(p => p.policy_type === 'webhook_check');
  const preliminary = {
    decision: highestDecision,
    reasons: [...reasons],
    warnings: [...warnings],
    matchedPolicies: [...matchedPolicies],
  };
  for (const policy of webhookPolicies) {
    let rules;
    try { rules = JSON.parse(policy.rules); } catch { continue; }

    const webhookResult = await evaluateWebhookPolicy(
      policy, rules, context, orgId, sql, preliminary
    );
    if (webhookResult) {
      applyResult(webhookResult, policy, reasons, warnings, matchedPolicies);
      if (DECISION_SEVERITY[webhookResult.action] > DECISION_SEVERITY[highestDecision]) {
        highestDecision = webhookResult.action;
      }
    }
  }

  // Optionally check live signals
  if (options.includeSignals && options.computeSignals) {
    try {
      const signals = await options.computeSignals(orgId, context.agent_id || null, sql);
      for (const signal of signals) {
        warnings.push(`Active signal: ${signal.type} — ${signal.label}`);
      }
    } catch {
      // Signal check is best-effort
    }
  }

  const evaluated_at = new Date().toISOString();

  // Log decision fire-and-forget
  const decisionId = `act_gd_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  // SECURITY: do not store raw secrets in guard decision context.
  // This keeps the evaluation logic unchanged; only the logged context is redacted.
  const dlpFindings = [];
  const safeContextForLog = redactAny(context, dlpFindings);
  if (dlpFindings.length > 0) {
    console.warn(`[Guard] Redacted ${dlpFindings.length} sensitive pattern(s) from guard_decisions.context before storing.`);
  }

  sql`
    INSERT INTO guard_decisions (id, org_id, agent_id, agent_name, decision, reason, matched_policies, context, risk_score, action_type, created_at)
    VALUES (
      ${decisionId},
      ${orgId},
      ${context.agent_id || null},
      ${context.agent_name || null},
      ${highestDecision},
      ${reasons.join('; ') || null},
      ${JSON.stringify(matchedPolicies)},
      ${JSON.stringify(safeContextForLog)},
      ${adjustedRiskScore},
      ${context.action_type || null},
      ${evaluated_at}
    )
  `.catch((err) => {
    console.warn('[Guard] Failed to persist guard_decisions audit row:', err.message);
  });

  void publishOrgEvent(EVENTS.GUARD_DECISION_CREATED, {
    orgId,
    decision: {
      id: decisionId,
      org_id: orgId,
      agent_id: context.agent_id || null,
      agent_name: context.agent_name || null,
      decision: highestDecision,
      reason: reasons.join('; ') || null,
      matched_policies: matchedPolicies,
      context: safeContextForLog,
      risk_score: adjustedRiskScore,
      agent_risk_score: agentRiskScore,
      action_type: context.action_type || null,
      created_at: evaluated_at
    }
  });

  // Learning context — best-effort enrichment
  const learningContext = await getLearningContext(sql, orgId, {
    agentId: context.agent_id,
    actionType: context.action_type,
  });

  // Recovery recipe evaluation — best-effort
  let recovery = null;
  try {
    if (highestDecision !== 'allow') {
      const recentSignals = [];
      if (context.intel?.branch?.freshness === 'stale') {
        recentSignals.push({ type: 'branch_stale', severity: 'amber', agent_id: context.agent_id });
      }
      if (context.intel?.mcp?.healthy === false) {
        recentSignals.push({ type: 'mcp_degraded', severity: 'amber', agent_id: context.agent_id });
      }
      if (reasons.some(r => r.includes('Green contract'))) {
        recentSignals.push({ type: 'green_insufficient', severity: 'red', agent_id: context.agent_id });
      }
      const recipes = evaluateRecoveryRecipes(recentSignals);
      if (recipes.length > 0) {
        recovery = recipes[0];
      }
    }
  } catch (e) { /* recovery is best-effort */ }

  return {
    decision: highestDecision,
    action_id: decisionId, // Standardized ID for the evaluation
    reason: reasons.join('; ') || null, // Primary reason string
    signals: [...warnings, ...reasons], // Combined signals for the SDK
    matched_policies: matchedPolicies,
    risk_score: adjustedRiskScore,
    agent_risk_score: agentRiskScore,
    evaluated_at,
    learning: learningContext || undefined,
    ...(recovery ? { recovery } : {}),
    ...(predictiveRisk ? { predictive_risk: predictiveRisk } : {}),
    // Backward compatibility
    reasons,
    warnings,
  };
}

function applyResult(result, policy, reasons, warnings, matchedPolicies) {
  if (result.action === 'warn') {
    warnings.push(`${policy.name}: ${result.reason}`);
  } else if (result.action !== 'allow') {
    reasons.push(`${policy.name}: ${result.reason}`);
  }
  if (result.extraWarnings) {
    warnings.push(...result.extraWarnings);
  }
  matchedPolicies.push(policy.id);
}

export async function evaluatePolicy(policy, rules, context, sql, orgId, effectiveRiskScore) {
  switch (policy.policy_type) {
    case 'risk_threshold': {
      const threshold = rules.threshold ?? 80;
      // Use server-computed authoritative risk score (passed in from evaluateGuard).
      // effectiveRiskScore is max(server-computed, agent-reported) and already clamped 0-100.
      const riskScore = effectiveRiskScore != null
        ? effectiveRiskScore
        : Math.max(0, Math.min(Number(context.risk_score) || 0, 100));
      if (riskScore >= threshold) {
        return { action: rules.action || 'block', reason: `Risk score ${riskScore} >= threshold ${threshold}` };
      }
      return null;
    }

    case 'require_approval': {
      const actionTypes = rules.action_types || [];
      if (actionTypes.includes(context.action_type)) {
        return { action: 'require_approval', reason: `Action type "${context.action_type}" requires approval` };
      }
      return null;
    }

    case 'block_action_type': {
      const actionTypes = rules.action_types || [];
      if (actionTypes.includes(context.action_type)) {
        return { action: 'block', reason: `Action type "${context.action_type}" is blocked by policy` };
      }
      return null;
    }

    case 'rate_limit': {
      const maxActions = rules.max_actions || 50;
      const windowMinutes = Math.max(1, Math.min(10080, parseInt(rules.window_minutes, 10) || 60));
      const agentId = context.agent_id;
      if (!agentId) return null;

      const rows = await sql.query(
        `SELECT COUNT(*) as cnt FROM action_records
         WHERE org_id = $1 AND agent_id = $2
         AND timestamp_start::timestamptz > NOW() - INTERVAL '1 minute' * $3`,
        [orgId, agentId, windowMinutes]
      );

      const count = parseInt(rows[0]?.cnt || '0', 10);
      if (count >= maxActions) {
        return { action: rules.action || 'warn', reason: `Agent performed ${count} actions in ${windowMinutes}min (limit: ${maxActions})` };
      }
      return null;
    }

    case 'webhook_check':
      // Handled separately after local policy loop
      return null;

    case 'behavioral_anomaly': {
      if (!isEmbeddingsEnabled()) {
        console.warn('[Guard] behavioral_anomaly policy skipped: No OpenAI API Key configured.');
        return null;
      }
      const threshold = rules.similarity_threshold ?? 0.75;
      const minHistory = rules.min_history ?? 5;
      const agentId = context.agent_id;
      if (!agentId) return null;

      // 1. Generate embedding for current proposed action
      const embedding = await generateActionEmbedding(context);
      if (!embedding) return null;

      // 2. Search for similar actions in history
      // Note: <=> is cosine distance in pgvector. Similarity = 1 - distance.
      const similarityQuery = `
        SELECT 1 - (embedding <=> $1::vector) as similarity
        FROM action_embeddings
        WHERE org_id = $2 AND agent_id = $3
        ORDER BY similarity DESC
        LIMIT 1
      `;
      
      try {
        const rows = await sql.query(similarityQuery, [JSON.stringify(embedding), orgId, agentId]);
        
        // 3. Evaluate anomaly
        if (rows.length === 0) {
          // No history yet
          return { action: 'warn', reason: 'New agent behavior: No historical data for similarity baseline.' };
        }

        const maxSimilarity = rows[0].similarity;
        if (maxSimilarity < threshold) {
          return { 
            action: rules.action || 'require_approval', 
            reason: `Behavioral Anomaly: Action similarity (${(maxSimilarity * 100).toFixed(1)}%) is below the safety threshold (${(threshold * 100).toFixed(0)}%).` 
          };
        }
      } catch (err) {
        if (err.message.includes('vector') || err.message.includes('does not exist')) {
          console.warn('[Guard] pgvector not enabled or table missing. Skipping anomaly detection.');
          return null;
        }
        throw err;
      }
      return null;
    }

    case 'semantic_check': {
      const instruction = rules.instruction;
      if (!instruction) return null;

      // Fallback when LLM check fails: 'allow' (fail-open) or 'block' (fail-closed).
      // Per-policy setting via rules.fallback, with global override via env var.
      const globalFallback = process.env.DASHCLAW_GUARD_FALLBACK || 'allow';
      const fallback = rules.fallback || globalFallback;
      const model = rules.model || 'gpt-4o-mini';

      // Detect "no key configured" before calling the LLM so we can apply a safe
      // middle-path fallback. When an LLM key is absent the semantic check can never
      // work, so fail-closed (block) is wrong — it silently blocks every action. Use
      // require_approval instead: the action is held for human review rather than
      // silently vanishing with no audit trail. (BUG-01 fix, 2026-04-11)
      const hasLlmKey = !!(process.env.GUARD_LLM_KEY || process.env.OPENAI_API_KEY);
      if (!hasLlmKey) {
        console.warn('[Guard] semantic_check policy skipped: No GUARD_LLM_KEY or OPENAI_API_KEY configured. Requiring approval as safe fallback.');
        return { action: 'require_approval', reason: 'Semantic check unavailable (no LLM key configured) — human review required' };
      }

      const result = await checkSemanticGuardrail(context, instruction, model);

      if (!result) {
        // LLM key is present but the API call failed (network error, rate limit, etc.)
        // Honor the policy's explicit fallback setting — operator has made a deliberate
        // choice about how to handle LLM failures.
        if (fallback === 'block') {
          return { action: 'block', reason: 'Semantic check failed (fallback: block)' };
        }
        if (fallback === 'require_approval') {
          return { action: 'require_approval', reason: 'Semantic check failed (fallback: require_approval)' };
        }
        return null; // fallback === 'allow' — pass-through
      }

      if (result.allowed === false) {
        return { action: 'block', reason: `Semantic Violation: ${result.reason}` };
      }
      return null;
    }

    case 'permission_escalation': {
      if (!rules.enforce) return null;
      const toolPerm = context.intel?.tool?.required_permission;
      if (!toolPerm) return null;
      const [pairing] = await sql`
        SELECT permission_level FROM agent_pairings
        WHERE org_id = ${orgId} AND agent_id = ${context.agent_id} AND status = 'approved'
        ORDER BY created_at DESC LIMIT 1
      `;
      const agentLevel = pairing?.permission_level || 'danger';
      const PERM_RANK = { readonly: 0, workspace_write: 1, danger: 2, prompt: 3, allow: 4 };
      if ((PERM_RANK[toolPerm] ?? 0) > (PERM_RANK[agentLevel] ?? 0)) {
        return { action: rules.action || 'block', reason: `Permission escalation: agent has ${agentLevel}, tool requires ${toolPerm}` };
      }
      return null;
    }

    case 'green_contract': {
      const actionTypes = rules.action_types || [];
      if (!actionTypes.includes(context.action_type)) return null;
      const observedLevel = context.intel?.green?.observed_level;
      const requiredLevel = rules.required_level;
      const GREEN_RANK = { targeted: 0, package: 1, workspace: 2, merge_ready: 3 };
      if (!observedLevel) {
        return { action: rules.action || 'block', reason: `Green contract: no test status reported, ${requiredLevel} required` };
      }
      if ((GREEN_RANK[observedLevel] ?? -1) < (GREEN_RANK[requiredLevel] ?? 0)) {
        return { action: rules.action || 'block', reason: `Green contract: observed ${observedLevel}, required ${requiredLevel}` };
      }
      return null;
    }

    case 'branch_freshness': {
      const actionTypes = rules.action_types || [];
      if (!actionTypes.includes(context.action_type)) return null;
      const branch = context.intel?.branch;
      if (!branch) return null;
      const triggerFreshness = rules.freshness || ['stale', 'diverged'];
      if (triggerFreshness.includes(branch.freshness)) {
        const maxBehind = rules.max_commits_behind ?? 0;
        if ((branch.commits_behind ?? 0) > maxBehind) {
          return { action: rules.action || 'block', reason: `Branch ${branch.name || 'unknown'} is ${branch.freshness} (${branch.commits_behind} commits behind)` };
        }
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * Evaluate a webhook_check policy by calling the customer's endpoint.
 * Customer decision can only upgrade severity (never downgrade).
 */
export async function evaluateWebhookPolicy(policy, rules, context, orgId, sql, preliminary) {
  const payload = {
    event: 'guard.evaluation',
    org_id: orgId,
    timestamp: new Date().toISOString(),
    context: {
      action_type: context.action_type,
      risk_score: context.risk_score ?? null,
      agent_id: context.agent_id ?? null,
      systems_touched: context.systems_touched ?? [],
      reversible: context.reversible ?? null,
      declared_goal: context.declared_goal ?? null,
    },
    preliminary_decision: preliminary.decision,
    matched_policies: preliminary.matchedPolicies,
    reasons: preliminary.reasons,
    warnings: preliminary.warnings,
  };

  const timeoutMs = rules.timeout_ms || 5000;
  const onTimeout = rules.on_timeout || 'allow';

  const result = await deliverGuardWebhook({
    url: rules.url,
    policyId: policy.id,
    orgId,
    payload,
    timeoutMs,
    sql,
  });

  if (!result.success || !result.response) {
    // Timeout or error — apply on_timeout rule
    if (onTimeout === 'block') {
      return { action: 'block', reason: 'Webhook check failed or timed out (on_timeout: block)' };
    }
    return null; // fail-open
  }

  const resp = result.response;
  const customerDecision = resp.decision;

  const customerReasons = Array.isArray(resp.reasons) ? resp.reasons : [];
  const customerWarnings = Array.isArray(resp.warnings)
    ? resp.warnings.map(w => `${policy.name} (webhook): ${w}`)
    : [];

  // Only accept valid decisions that are more restrictive than preliminary
  if (customerDecision && DECISION_SEVERITY[customerDecision] !== undefined) {
    if (DECISION_SEVERITY[customerDecision] > DECISION_SEVERITY[preliminary.decision]) {
      const reason = customerReasons.length > 0
        ? customerReasons.join('; ')
        : `Webhook escalated to ${customerDecision}`;
      return { action: customerDecision, reason: `${policy.name} (webhook): ${reason}`, extraWarnings: customerWarnings };
    }
  }

  // Customer response doesn't escalate — return warnings only (as a warn-level result)
  if (customerWarnings.length > 0) {
    return { action: 'warn', reason: customerWarnings[0], extraWarnings: customerWarnings.slice(1) };
  }
  return null;
}
