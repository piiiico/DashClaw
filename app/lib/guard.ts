/**
 * Guard evaluation engine.
 * Evaluates agent context against org policies and returns allow/warn/block/require_approval.
 */

import { randomUUID } from 'node:crypto';
import { baseAgentId } from './agent-identity-resolve.js';
import { deliverGuardWebhook } from './webhooks.js';
import { checkSemanticGuardrail } from './llm.js';
import { generateActionEmbedding, isEmbeddingsEnabled } from './embeddings.js';
import { scanSensitiveData } from './security.js';
import { scanForPromptInjection } from './promptInjection.js';
import { EVENTS, publishOrgEvent } from './events.js';
import { getLearningContext } from './learning-context.js';
import { evaluateRecoveryRecipes } from './recovery.js';
import { getActBindingMode } from './act-binding.js';
import { matchesProtectedPath } from './behavior/path-match.js';
import { verify } from './integrity/verify.js';
import { issueReceipt } from './integrity/receipt.js';
import { getServerSigningKey } from './integrity/server-key.js';

const DECISION_SEVERITY = { allow: 0, warn: 1, require_approval: 2, block: 3 } as const;
const SEVERITY = DECISION_SEVERITY as Record<string, number>;
/** Severity of a decision string (0 for an unknown value — matches JS `undefined`-comparison behaviour). */
const sevOf = (d: string): number => SEVERITY[d] ?? 0;
const hasSev = (d: string): boolean => SEVERITY[d] !== undefined;

const ACTION_TYPE_BASE_SCORES = {
  deploy: 75, security: 80, migrate: 70, apply: 60, sync: 40,
  api: 35, build: 25, fix: 20, refactor: 20, test: 15,
  config: 30, monitor: 10, alert: 10, cleanup: 30, post: 25,
  message: 15, calendar: 10, research: 10, review: 10, other: 20,
} as const;
const baseScore = (t: unknown): number =>
  (typeof t === 'string' ? (ACTION_TYPE_BASE_SCORES as Record<string, number>)[t] : undefined) ?? ACTION_TYPE_BASE_SCORES.other;

/** Lookup into a rank table by an untrusted key, with a fallback. */
const rankOf = (table: Record<string, number>, key: unknown, fallback: number): number =>
  (typeof key === 'string' ? table[key] : undefined) ?? fallback;

const HIGH_RISK_SYSTEMS = ['production', 'database', 'postgres', 'neon', 'redis'];
const MODERATE_RISK_SYSTEMS = ['filesystem', 'shell'];
const DESTRUCTIVE_GOAL_PATTERNS = /rm\s+-rf|drop\s+table|delete\s+from|truncate|format|wipe/i;
const DEPLOYMENT_GOAL_PATTERNS = /push|deploy|release|ship|migrate/i;
const SECRET_GOAL_PATTERNS = /secret|credential|password|token|key|\.env/i;

/** SQL client usable as a tagged template AND via `.query()` (Neon/postgres shape). */
type GuardSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

interface GuardEvalContext {
  action_type?: string;
  agent_id?: string | null;
  agent_name?: string | null;
  risk_score?: number | string | null;
  systems_touched?: unknown;
  reversible?: boolean;
  declared_goal?: string | null;
  verification_status?: string;
  replay_status?: string;
  act_status?: string;
  jti?: string | null;
  act_hash?: string | null;
  target?: string;
  write_paths?: unknown;
  provider?: string;
  vendor?: string;
  provider_id?: string | null;
  cost_estimate?: number;
  cost?: number;
  tool?: { required_permission?: string };
  intel?: {
    branch?: { freshness: string; commits_behind?: number; name?: string };
    mcp?: { healthy?: boolean };
    green?: { observed_level?: string };
    tool?: { required_permission?: string };
  };
  [field: string]: unknown;
}

interface PolicyRow {
  id: string;
  name: string;
  policy_type: string;
  rules: string;
  agent_ids?: string | null;
  [field: string]: unknown;
}

interface PolicyRules {
  threshold?: number;
  action?: string;
  action_types?: string[];
  paths?: string[];
  max_actions?: number;
  window_minutes?: number;
  url?: string;
  timeout_ms?: number;
  on_timeout?: string;
  content_path?: string;
  source_path?: string;
  on_violation?: string;
  similarity_threshold?: number;
  min_history?: number;
  instruction?: string;
  model?: string;
  fallback?: string;
  enforce?: boolean;
  required_level?: string;
  freshness?: string[];
  max_commits_behind?: number;
  max_spend_usd?: number;
  approval_threshold?: number;
  allowed_providers?: string[];
  blocked_providers?: string[];
}

interface PolicyResult {
  action: string;
  reason: string;
  nonFabrication?: unknown;
  stripPaths?: string[];
  extraWarnings?: string[];
}

interface GuardOptions {
  includeSignals?: boolean;
  computeSignals?: (orgId: string, agentId: string | null, sql: GuardSql) => Promise<Array<{ type: string; label: string }>>;
}

interface Preliminary {
  decision: string;
  reasons: string[];
  warnings: string[];
  matchedPolicies: string[];
}

/**
 * Compute an authoritative risk score from structured guard context fields.
 * Returns an integer 0-100.
 */
export function computeRiskScore(context: GuardEvalContext): number {
  let score = baseScore(context.action_type);

  if (context.reversible === false) score += 15;

  if (Array.isArray(context.systems_touched)) {
    const systems = context.systems_touched.map((s) => (typeof s === 'string' ? s.toLowerCase() : ''));
    if (systems.some((s) => HIGH_RISK_SYSTEMS.includes(s))) score += 10;
    if (systems.some((s) => MODERATE_RISK_SYSTEMS.includes(s))) score += 5;
  }

  if (typeof context.declared_goal === 'string') {
    if (DESTRUCTIVE_GOAL_PATTERNS.test(context.declared_goal)) score += 20;
    if (DEPLOYMENT_GOAL_PATTERNS.test(context.declared_goal)) score += 10;
    if (SECRET_GOAL_PATTERNS.test(context.declared_goal)) score += 15;
  }

  return Math.max(0, Math.min(score, 100));
}

// Resolve a dotted field path into the guard context. Returns undefined for any missing segment.
function getByPath(obj: unknown, path: unknown): unknown {
  if (obj == null || typeof path !== 'string') return undefined;
  return path.split('.').reduce<unknown>((acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]), obj);
}

// Replace the leaf at `path` with `marker` if present. Used to keep raw
// non_fabrication inputs out of the persisted guard_decisions.context row.
function redactByPath(obj: unknown, path: unknown, marker: unknown): void {
  if (obj == null || typeof path !== 'string') return;
  const keys = path.split('.');
  let cur: unknown = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur == null || typeof cur !== 'object' || k === undefined) return;
    cur = (cur as Record<string, unknown>)[k];
  }
  const leaf = keys[keys.length - 1];
  if (leaf !== undefined && cur && typeof cur === 'object' && leaf in cur) {
    (cur as Record<string, unknown>)[leaf] = marker;
  }
}

function redactAny(value: unknown, findings: unknown[]): unknown {
  if (typeof value === 'string') {
    const scan = scanSensitiveData(value);
    if (!scan.clean) findings.push(...scan.findings);
    return scan.redacted;
  }
  if (Array.isArray(value)) return value.map((v) => redactAny(v, findings));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactAny(v, findings);
    return out;
  }
  return value;
}

/**
 * Evaluate guard policies for an incoming agent action.
 */
export async function evaluateGuard(orgId: string, context: GuardEvalContext, sql: GuardSql, options: GuardOptions = {}) {
  // SECURITY: orgId is the tenant boundary. Without this guard a caller bug
  // that loses orgId (null/undefined/'') would cause Postgres to evaluate
  // `WHERE org_id = NULL AND ...` which silently returns zero rows — guard
  // would then approve every action because no policies matched.
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('evaluateGuard: orgId is required and must be a string');
  }

  // Phase 2b (issue #120): block replays before policy evaluation so the audit
  // row records exactly why this call was blocked.
  const replayProtection = (process.env.DASHCLAW_JTI_REPLAY_PROTECTION || 'best_effort').toLowerCase();
  const replayStatusEarly = context.replay_status || 'not_applicable';
  let replayBlockReason: string | null = null;
  if (replayStatusEarly === 'replayed') {
    replayBlockReason = `Replay detected: jti has been seen in a prior verified guard call within its exp window.`;
  } else if (replayStatusEarly === 'exp_too_far') {
    replayBlockReason = `Token exp exceeds the configured max TTL (DASHCLAW_JTI_MAX_TTL_SECONDS).`;
  } else if (replayStatusEarly === 'unavailable' && replayProtection === 'required') {
    replayBlockReason = `Replay store unreachable and DASHCLAW_JTI_REPLAY_PROTECTION=required.`;
  } else if (replayStatusEarly === 'not_present' && replayProtection === 'required') {
    replayBlockReason = `Verified token has no jti claim and DASHCLAW_JTI_REPLAY_PROTECTION=required.`;
  }
  if (replayBlockReason) {
    console.warn('[Guard] Replay-protection block:', {
      reason: replayBlockReason,
      replay_status: replayStatusEarly,
      jti: context.jti || null,
      agent_id: context.agent_id || null,
      org_id: orgId,
    });
  }

  // Phase 2c (issue #121): action-binding block decision. Mirrors replay_status
  // exactly — its own axis, decided here at the audit boundary, never re-checked.
  const actBindingMode = getActBindingMode();
  const actStatusEarly = context.act_status || 'not_applicable';
  let actBlockReason: string | null = null;
  if (actBindingMode !== 'off' && actStatusEarly === 'mismatch') {
    actBlockReason = 'Action-binding mismatch: token committed to a different (action, target, goal) than this call.';
  } else if (
    actBindingMode === 'required' &&
    (actStatusEarly === 'not_present' || actStatusEarly === 'unsupported_typ' || actStatusEarly === 'ctx_incomplete')
  ) {
    actBlockReason = `Action-binding ${actStatusEarly} and DASHCLAW_ACT_BINDING=required.`;
  }
  if (actBlockReason) {
    console.warn('[Guard] Action-binding block:', {
      reason: actBlockReason,
      act_status: actStatusEarly,
      agent_id: context.agent_id || null,
      org_id: orgId,
    });
  }

  const allPolicies = await sql`
    SELECT id, name, policy_type, rules, agent_ids
    FROM guard_policies
    WHERE org_id = ${orgId} AND active = 1
  `;

  // Filter to policies that apply to this agent (null agent_ids = all agents)
  const currentAgentId = context.agent_id || null;
  const policies = (allPolicies as PolicyRow[]).filter((p) => {
    if (!p.agent_ids) return true; // null/empty = applies to all
    try {
      const scoped = JSON.parse(p.agent_ids);
      if (!Array.isArray(scoped) || scoped.length === 0) return true;
      return Boolean(currentAgentId && scoped.includes(currentAgentId));
    } catch (parseErr) {
      // Fail closed on malformed scope data: skip the policy rather than silently
      // widening a targeted rule to govern every agent in the org.
      console.error('[GUARD] Skipping policy with malformed agent_ids:', p.id, (parseErr as Error).message);
      return false;
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
  let predictiveRisk: { total_adjustment?: number } | null = null;
  try {
    const { getPredictiveRisk } = await import('./predictive-risk.js');
    const { getSettings } = await import('./repositories/settings.repository.js');
    const riskSettings = await getSettings(sql, orgId, { category: 'general' });
    const settingsList = riskSettings as Array<Record<string, unknown>>;
    const prEnabled = settingsList.find((s) => s.key === 'PREDICTIVE_RISK_ENABLED')?.value === 'true';
    const prThreshold = parseInt(String(settingsList.find((s) => s.key === 'PREDICTIVE_RISK_THRESHOLD')?.value ?? ''), 10) || 60;

    if (context.agent_id && context.action_type) {
      predictiveRisk = await getPredictiveRisk(
        sql, orgId, context.agent_id, context.action_type, effectiveRiskScore,
        { enabled: prEnabled, threshold: prThreshold }
      );
    }
  } catch (e) {
    // Predictive risk is best-effort — never block guard on failure
    console.warn('[Guard] Predictive risk failed:', (e as Error).message);
  }

  // Apply statistical adjustment to risk score. Round to an integer.
  const predictiveAdjustment = predictiveRisk?.total_adjustment ?? 0;
  const adjustedRiskScore = Math.round(Math.max(0, Math.min(effectiveRiskScore + predictiveAdjustment, 100)));

  const reasons: string[] = [];
  const warnings: string[] = [];
  const matchedPolicies: string[] = [];
  const nonFabEvidence: unknown[] = [];
  const nonFabStripPaths = new Set<string>();
  let highestDecision = 'allow';

  for (const policy of policies) {
    let rules: PolicyRules;
    try {
      rules = JSON.parse(policy.rules);
    } catch {
      continue; // skip malformed
    }

    const result = await evaluatePolicy(policy, rules, context, sql, orgId, adjustedRiskScore);
    if (result) {
      applyResult(result, policy, reasons, warnings, matchedPolicies);
      if (result.nonFabrication) {
        nonFabEvidence.push(result.nonFabrication);
        for (const p of result.stripPaths || []) nonFabStripPaths.add(p);
      }
      if (sevOf(result.action) > sevOf(highestDecision)) {
        highestDecision = result.action;
      }
    }
  }

  // Default-on prompt injection scanning (opt-out via DISABLE_PROMPT_INJECTION_SCAN=true)
  if (process.env.DISABLE_PROMPT_INJECTION_SCAN !== 'true') {
    const textFields = [context.declared_goal, context.action_type].filter(Boolean) as string[];
    for (const text of textFields) {
      const scan = scanForPromptInjection(text);
      if (!scan.clean) {
        const reason = `Prompt injection detected (${scan.risk_level}): ${scan.categories.join(', ')}`;
        if (scan.recommendation === 'block') {
          reasons.push(reason);
          matchedPolicies.push('builtin:prompt_injection_scan');
          if (DECISION_SEVERITY.block > sevOf(highestDecision)) {
            highestDecision = 'block';
          }
        } else if (scan.recommendation === 'warn') {
          warnings.push(reason);
        }
      }
    }
  }

  // Process webhook_check policies (after local policies, so preliminary decision is known)
  const webhookPolicies = policies.filter((p) => p.policy_type === 'webhook_check');
  const preliminary: Preliminary = {
    decision: highestDecision,
    reasons: [...reasons],
    warnings: [...warnings],
    matchedPolicies: [...matchedPolicies],
  };
  for (const policy of webhookPolicies) {
    let rules: PolicyRules;
    try { rules = JSON.parse(policy.rules); } catch { continue; }

    const webhookResult = await evaluateWebhookPolicy(policy, rules, context, orgId, sql, preliminary);
    if (webhookResult) {
      applyResult(webhookResult, policy, reasons, warnings, matchedPolicies);
      if (sevOf(webhookResult.action) > sevOf(highestDecision)) {
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

  const decisionId = `act_gd_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  // SECURITY: do not store raw secrets in guard decision context.
  const dlpFindings: unknown[] = [];
  const safeContextForLog = redactAny(context, dlpFindings);
  if (dlpFindings.length > 0) {
    console.warn(`[Guard] Redacted ${dlpFindings.length} sensitive pattern(s) from guard_decisions.context before storing.`);
  }
  for (const p of nonFabStripPaths) redactByPath(safeContextForLog, p, '[redacted:non_fabrication_input]');
  const evidenceJson = nonFabEvidence.length > 0 ? JSON.stringify(nonFabEvidence) : null;

  const verificationStatus = context.verification_status || 'unverified';
  const replayStatus = context.replay_status || 'not_applicable';
  const jti = context.jti || null;
  const actStatus = context.act_status || 'not_applicable';
  const actHash = context.act_hash || null;

  // If the replay pre-check decided to block, override the policy outcome.
  if (replayBlockReason && DECISION_SEVERITY.block >= sevOf(highestDecision)) {
    highestDecision = 'block';
    reasons.unshift(replayBlockReason);
  } else if (replayBlockReason) {
    reasons.unshift(replayBlockReason);
  }

  // Phase 2c: same override shape as replay — binding evidence forces `block`.
  if (actBlockReason && DECISION_SEVERITY.block >= sevOf(highestDecision)) {
    highestDecision = 'block';
    reasons.unshift(actBlockReason);
  } else if (actBlockReason) {
    reasons.unshift(actBlockReason);
  }

  // SECURITY (R2): the guard_decisions row IS the audit evidence — losing it
  // means the platform cannot prove what it decided. Await it and fail loudly.
  try {
    await sql`
      INSERT INTO guard_decisions (id, org_id, agent_id, agent_name, verification_status, replay_status, jti, act_status, act_hash, decision, reason, matched_policies, context, evidence, risk_score, action_type, created_at)
      VALUES (
        ${decisionId},
        ${orgId},
        ${context.agent_id || null},
        ${context.agent_name || null},
        ${verificationStatus},
        ${replayStatus},
        ${jti},
        ${actStatus},
        ${actHash},
        ${highestDecision},
        ${reasons.join('; ') || null},
        ${JSON.stringify(matchedPolicies)},
        ${JSON.stringify(safeContextForLog)},
        ${evidenceJson},
        ${adjustedRiskScore},
        ${context.action_type || null},
        ${evaluated_at}
      )
    `;
  } catch (err) {
    console.error('[Guard] CRITICAL: failed to persist required guard_decisions audit row:', (err as Error)?.message || err);
    const persistError = Object.assign(
      new Error('Guard decision could not be durably recorded; refusing to return an unaudited decision.'),
      { code: 'GUARD_AUDIT_PERSIST_FAILED' },
    );
    throw persistError;
  }

  void publishOrgEvent(EVENTS.GUARD_DECISION_CREATED, {
    orgId,
    decision: {
      id: decisionId,
      org_id: orgId,
      agent_id: context.agent_id || null,
      agent_name: context.agent_name || null,
      verification_status: verificationStatus,
      replay_status: replayStatus,
      jti,
      act_status: actStatus,
      act_hash: actHash,
      decision: highestDecision,
      reason: reasons.join('; ') || null,
      matched_policies: matchedPolicies,
      context: safeContextForLog,
      risk_score: adjustedRiskScore,
      agent_risk_score: agentRiskScore,
      action_type: context.action_type || null,
      created_at: evaluated_at,
    },
  });

  // Learning context — best-effort enrichment
  const learningContext = await getLearningContext(sql, orgId, {
    agentId: context.agent_id,
    actionType: context.action_type,
  });

  // Recovery recipe evaluation — best-effort
  let recovery: unknown = null;
  try {
    if (highestDecision !== 'allow') {
      const recentSignals: Array<{ type: string; severity: string; agent_id?: string | null }> = [];
      if (context.intel?.branch?.freshness === 'stale') {
        recentSignals.push({ type: 'branch_stale', severity: 'amber', agent_id: context.agent_id });
      }
      if (context.intel?.mcp?.healthy === false) {
        recentSignals.push({ type: 'mcp_degraded', severity: 'amber', agent_id: context.agent_id });
      }
      if (reasons.some((r) => r.includes('Green contract'))) {
        recentSignals.push({ type: 'green_insufficient', severity: 'red', agent_id: context.agent_id });
      }
      const recipes = evaluateRecoveryRecipes(recentSignals as Array<{ type: string; severity: string; agent_id: string }>);
      if (recipes.length > 0) {
        recovery = recipes[0];
      }
    }
  } catch (e) { /* recovery is best-effort */ }

  return {
    decision: highestDecision,
    decision_id: decisionId, // Canonical: the guard-evaluation id (act_gd_*).
    action_id: decisionId, // DEPRECATED alias of decision_id (the evaluation id, NOT action_records id).
    reason: reasons.join('; ') || null,
    signals: [...warnings, ...reasons],
    matched_policies: matchedPolicies,
    ...(nonFabEvidence.length > 0 ? { non_fabrication: nonFabEvidence } : {}),
    risk_score: adjustedRiskScore,
    agent_risk_score: agentRiskScore,
    verification_status: verificationStatus,
    agent_id: context.agent_id || null,
    agent_name: context.agent_name || null,
    evaluated_at,
    learning: learningContext || undefined,
    ...(recovery ? { recovery } : {}),
    ...(predictiveRisk ? { predictive_risk: predictiveRisk } : {}),
    // Backward compatibility
    reasons,
    warnings,
  };
}

function applyResult(result: PolicyResult, policy: PolicyRow, reasons: string[], warnings: string[], matchedPolicies: string[]): void {
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

export async function evaluatePolicy(
  policy: PolicyRow,
  rules: PolicyRules,
  context: GuardEvalContext,
  sql: GuardSql,
  orgId: string,
  effectiveRiskScore: number,
): Promise<PolicyResult | null> {
  switch (policy.policy_type) {
    case 'risk_threshold': {
      const threshold = rules.threshold ?? 80;
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
      if (context.action_type !== undefined && actionTypes.includes(context.action_type)) {
        return { action: 'require_approval', reason: `Action type "${context.action_type}" requires approval` };
      }
      return null;
    }

    case 'block_action_type': {
      const actionTypes = rules.action_types || [];
      if (context.action_type !== undefined && actionTypes.includes(context.action_type)) {
        return { action: 'block', reason: `Action type "${context.action_type}" is blocked by policy` };
      }
      return null;
    }

    case 'protected_path': {
      const paths = Array.isArray(rules.paths) ? rules.paths : [];
      if (paths.length === 0) return null;
      const candidates: string[] = [];
      if (typeof context.target === 'string' && context.target) candidates.push(context.target);
      if (Array.isArray(context.write_paths)) candidates.push(...(context.write_paths as string[]));
      const hit = candidates.find((p) => matchesProtectedPath(p, paths));
      if (hit) {
        return { action: rules.action || 'require_approval', reason: `Protected path touched: ${hit}` };
      }
      return null;
    }

    case 'rate_limit': {
      const maxActions = rules.max_actions || 50;
      const windowMinutes = Math.max(1, Math.min(10080, parseInt(String(rules.window_minutes), 10) || 60));
      const agentId = context.agent_id;
      if (!agentId) return null;

      const rows = await sql.query(
        `SELECT COUNT(*) as cnt FROM action_records
         WHERE org_id = $1 AND agent_id = $2
         AND timestamp_start::timestamptz > NOW() - INTERVAL '1 minute' * $3`,
        [orgId, agentId, windowMinutes]
      );

      const count = parseInt((rows[0]?.cnt as string) || '0', 10);
      if (count >= maxActions) {
        return { action: rules.action || 'warn', reason: `Agent performed ${count} actions in ${windowMinutes}min (limit: ${maxActions})` };
      }
      return null;
    }

    case 'webhook_check':
      // Handled separately after local policy loop
      return null;

    case 'non_fabrication': {
      const actionTypes = Array.isArray(rules.action_types) ? rules.action_types : null;
      if (actionTypes && actionTypes.length > 0 && (context.action_type === undefined || !actionTypes.includes(context.action_type))) {
        return null;
      }

      const contentPath = (typeof rules.content_path === 'string' && rules.content_path) || 'content';
      const sourcePath = (typeof rules.source_path === 'string' && rules.source_path) || 'source_of_truth';
      const onViolation = rules.on_violation === 'require_approval' ? 'require_approval' : 'block';
      const stripPaths = [contentPath, sourcePath];

      const content = getByPath(context, contentPath);
      if (content == null || content === '') return null;

      const issue = async (verifyResult: { verdict: string; violations: unknown[] }, source: unknown): Promise<unknown> => {
        try {
          const key = await getServerSigningKey(sql);
          return issueReceipt(
            verifyResult,
            String(content),
            source as object,
            { kid: key.kid, privateKeyJwk: key.privateKeyJwk },
            new Date().toISOString(),
          );
        } catch (e) {
          console.warn('[Guard] non_fabrication receipt signing failed (verdict still enforced):', (e as Error).message);
          return null;
        }
      };

      const source = getByPath(context, sourcePath);
      const sourceObj = source as { allowedFacts?: unknown; requiredFacts?: unknown } | null;
      const sourceValid = Boolean(
        sourceObj && typeof sourceObj === 'object' && !Array.isArray(sourceObj) &&
        Array.isArray(sourceObj.allowedFacts) && Array.isArray(sourceObj.requiredFacts)
      );

      if (typeof content !== 'string' || !sourceValid) {
        const verdict = {
          verdict: 'block',
          violations: [
            sourceValid
              ? { code: 'invalid_content', label: 'content' }
              : { code: 'missing_source', label: 'source_of_truth' },
          ],
        };
        const receipt = sourceValid && typeof content === 'string' ? await issue(verdict, source) : null;
        return {
          action: 'block',
          reason: sourceValid
            ? 'Non-fabrication: content is not verifiable text (fail-closed)'
            : 'Non-fabrication: source-of-truth missing or malformed (fail-closed)',
          nonFabrication: { policy_id: policy.id, verdict: 'block', violations: verdict.violations, receipt },
          stripPaths,
        };
      }

      const verifyResult = verify(content, source as Record<string, unknown>);
      const receipt = await issue(verifyResult, source);

      if (verifyResult.verdict === 'pass') {
        return {
          action: 'allow',
          reason: 'Non-fabrication: pass',
          nonFabrication: { policy_id: policy.id, verdict: 'pass', violations: [], receipt },
          stripPaths,
        };
      }

      const summary = verifyResult.violations
        .map((v: { detail?: string; label: string; code: string }) => (v.detail ? `${v.label}: ${v.detail}` : v.code === 'missing_required' ? `missing ${v.label}` : v.label))
        .slice(0, 5)
        .join(', ');
      return {
        action: onViolation,
        reason: `Non-fabrication: ${verifyResult.violations[0]?.code} (${summary})`,
        nonFabrication: { policy_id: policy.id, verdict: 'block', violations: verifyResult.violations, receipt },
        stripPaths,
      };
    }

    case 'behavioral_anomaly': {
      if (!isEmbeddingsEnabled()) {
        console.warn('[Guard] behavioral_anomaly policy skipped: No OpenAI API Key configured.');
        return null;
      }
      const threshold = rules.similarity_threshold ?? 0.75;
      const minHistory = rules.min_history ?? 5;
      const agentId = context.agent_id;
      if (!agentId) return null;

      let historyCount = 0;
      try {
        const countRows = await sql`
          SELECT COUNT(*)::int AS count
          FROM action_embeddings
          WHERE org_id = ${orgId} AND agent_id = ${agentId}
        `;
        historyCount = (countRows[0]?.count as number | undefined) ?? 0;
      } catch (err) {
        const msg = (err as Error)?.message;
        if (msg?.includes('does not exist') || msg?.includes('vector')) {
          console.warn('[Guard] action_embeddings missing or pgvector unavailable. Skipping anomaly detection.');
          return null;
        }
        throw err;
      }
      if (historyCount < minHistory) return null;

      const embedding = await generateActionEmbedding(context);
      if (!embedding) return null;

      const similarityQuery = `
        SELECT 1 - (embedding <=> $1::vector) as similarity
        FROM action_embeddings
        WHERE org_id = $2 AND agent_id = $3
        ORDER BY similarity DESC
        LIMIT 1
      `;

      try {
        const rows = await sql.query(similarityQuery, [JSON.stringify(embedding), orgId, agentId]);

        if (rows.length === 0) {
          return null;
        }

        const maxSimilarity = Number(rows[0]?.similarity);
        if (maxSimilarity < threshold) {
          return {
            action: rules.action || 'require_approval',
            reason: `Behavioral Anomaly: Action similarity (${(maxSimilarity * 100).toFixed(1)}%) is below the safety threshold (${(threshold * 100).toFixed(0)}%).`,
          };
        }
      } catch (err) {
        const msg = (err as Error).message;
        if (msg?.includes('vector') || msg?.includes('does not exist')) {
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

      const globalFallback = process.env.DASHCLAW_GUARD_FALLBACK || 'allow';
      const fallback = rules.fallback || globalFallback;
      const model = rules.model || 'gpt-4o-mini';

      const hasLlmKey = !!(process.env.GUARD_LLM_KEY || process.env.OPENAI_API_KEY);
      if (!hasLlmKey) {
        console.warn('[Guard] semantic_check policy skipped: No GUARD_LLM_KEY or OPENAI_API_KEY configured. Requiring approval as safe fallback.');
        return { action: 'require_approval', reason: 'Semantic check unavailable (no LLM key configured) — human review required' };
      }

      const result = await checkSemanticGuardrail(context, instruction, model);

      if (!result) {
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
      const toolPerm = context.intel?.tool?.required_permission ?? context.tool?.required_permission;
      if (!toolPerm) return null;
      const pairingBaseId = baseAgentId(context.agent_id) || context.agent_id;
      const [pairing] = await sql`
        SELECT permission_level FROM agent_pairings
        WHERE org_id = ${orgId} AND agent_id IN (${context.agent_id}, ${pairingBaseId}) AND status = 'approved'
        ORDER BY (agent_id = ${context.agent_id}) DESC, created_at DESC LIMIT 1
      `;
      const agentLevel = (pairing?.permission_level as string | undefined) || 'danger';
      const PERM_RANK: Record<string, number> = { readonly: 0, workspace_write: 1, danger: 2, prompt: 3, allow: 4 };
      if (rankOf(PERM_RANK, toolPerm, 0) > rankOf(PERM_RANK, agentLevel, 0)) {
        return { action: rules.action || 'block', reason: `Permission escalation: agent has ${agentLevel}, tool requires ${toolPerm}` };
      }
      return null;
    }

    case 'green_contract': {
      const actionTypes = rules.action_types || [];
      if (context.action_type === undefined || !actionTypes.includes(context.action_type)) return null;
      const observedLevel = context.intel?.green?.observed_level;
      const requiredLevel = rules.required_level;
      const GREEN_RANK: Record<string, number> = { targeted: 0, package: 1, workspace: 2, merge_ready: 3 };
      if (!observedLevel) {
        return { action: rules.action || 'block', reason: `Green contract: no test status reported, ${requiredLevel} required` };
      }
      if (rankOf(GREEN_RANK, observedLevel, -1) < rankOf(GREEN_RANK, requiredLevel, 0)) {
        return { action: rules.action || 'block', reason: `Green contract: observed ${observedLevel}, required ${requiredLevel}` };
      }
      return null;
    }

    case 'branch_freshness': {
      const actionTypes = rules.action_types || [];
      if (context.action_type === undefined || !actionTypes.includes(context.action_type)) return null;
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

    case 'x402_spend_limit': {
      if (context.action_type !== 'x402_purchase') return null;
      const maxSpend = rules.max_spend_usd ?? Infinity;
      const approvalThreshold = rules.approval_threshold ?? Infinity;
      const allowed = Array.isArray(rules.allowed_providers) ? rules.allowed_providers : [];
      const blocked = Array.isArray(rules.blocked_providers) ? rules.blocked_providers : [];
      const provider = context.provider || context.vendor || 'unknown';
      const providerId = context.provider_id || null;
      const inList = (list: string[]): boolean => list.includes(provider) || (providerId != null && list.includes(providerId));
      const spend = Number(context.cost_estimate ?? context.cost ?? 0) || 0;

      if (inList(blocked)) {
        return { action: 'block', reason: `Provider "${provider}" is blocked by policy` };
      }
      if (allowed.length > 0 && !inList(allowed)) {
        return { action: 'block', reason: `Provider "${provider}" not in approved list` };
      }
      if (spend > maxSpend) {
        return { action: 'block', reason: `Spend $${spend.toFixed(4)} exceeds max $${maxSpend}` };
      }
      if (spend >= approvalThreshold) {
        return { action: 'require_approval', reason: `Spend $${spend.toFixed(4)} >= approval threshold $${approvalThreshold}` };
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
export async function evaluateWebhookPolicy(
  policy: PolicyRow,
  rules: PolicyRules,
  context: GuardEvalContext,
  orgId: string,
  sql: GuardSql,
  preliminary: Preliminary,
): Promise<PolicyResult | null> {
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
    // rules.url is string|undefined on the loose policy-config type; a webhook
    // policy always has it, and deliverGuardWebhook's safeUrlWithIps(url) runs
    // inside a try/catch that already fails closed on a missing/invalid URL —
    // so passing it through preserves the original runtime behavior exactly.
    url: rules.url as string,
    policyId: policy.id,
    orgId,
    payload,
    timeoutMs,
    sql,
  });

  if (!result.success || !result.response) {
    if (onTimeout === 'block') {
      return { action: 'block', reason: 'Webhook check failed or timed out (on_timeout: block)' };
    }
    return null; // fail-open
  }

  const resp = result.response as { decision?: string; reasons?: unknown; warnings?: unknown };
  const customerDecision = resp.decision;

  const customerReasons: string[] = Array.isArray(resp.reasons) ? resp.reasons : [];
  const customerWarnings: string[] = Array.isArray(resp.warnings)
    ? resp.warnings.map((w: string) => `${policy.name} (webhook): ${w}`)
    : [];

  // Only accept valid decisions that are more restrictive than preliminary
  if (customerDecision && hasSev(customerDecision)) {
    if (sevOf(customerDecision) > sevOf(preliminary.decision)) {
      const reason = customerReasons.length > 0
        ? customerReasons.join('; ')
        : `Webhook escalated to ${customerDecision}`;
      return { action: customerDecision, reason: `${policy.name} (webhook): ${reason}`, extraWarnings: customerWarnings };
    }
  }

  // Customer response doesn't escalate — return warnings only (as a warn-level result)
  if (customerWarnings.length > 0) {
    return { action: 'warn', reason: customerWarnings[0] as string, extraWarnings: customerWarnings.slice(1) };
  }
  return null;
}
