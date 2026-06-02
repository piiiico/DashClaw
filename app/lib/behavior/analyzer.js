/**
 * Deterministic Behavior Learning analyzer. Turns redacted local samples into
 * evidence-backed, per-agent policy suggestions. No LLM, no randomness, no
 * clock dependence beyond the sample timestamps — the same samples always
 * produce the same suggestions (required for stable dismiss suppression and
 * testability).
 *
 * Emits the six V1 suggestion types. Two (destructive-command, protected-path)
 * carry a faithful `draft_policy` that maps to a real guard policy; the other
 * four are advisory observations (no guard policy in V1).
 */

import {
  RULE_KINDS, DEFAULTS, isEnforceable, behaviorRuleToGuardPolicy,
  detectReloadLoops, detectFailureLoops, decideSample,
} from './policy-model.js';
import { classifyProtectedPath, PROTECTED_PATH_GROUPS } from './path-match.js';

const READONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']);
const SAFE_BASH_VERBS = new Set(['ls', 'cat', 'pwd', 'echo', 'git', 'npm', 'npx', 'node', 'pnpm', 'yarn', 'pytest', 'vitest', 'eslint', 'tsc', 'python', 'python3']);
// Bash command shapes that are safe even though the verb is broad (e.g. npm).
const SAFE_COMMAND_RE = /\b(test|lint|build|typecheck|format|status|diff|log|coverage|--version|-v)\b/;

const DEFAULT_OPTIONS = Object.freeze({
  minSamples: 8, // per-agent minimum before any suggestion is offered
  minMatch: 3, // per-pattern minimum matching samples
  maxEvidence: 10,
  maxExamples: 5,
});

/** Deterministic 32-bit FNV-1a hash → 8-hex string (stable suggestion ids). */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function suggestionSignature(type, agentId, target) {
  return `bsg_${fnv1a(`${type}::${agentId || 'all'}::${target || ''}`)}`;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function fpRisk(flagged, flaggedCompleted) {
  if (!flagged) return 'low';
  const ratio = flaggedCompleted / flagged;
  if (ratio >= 0.5) return 'high';
  if (ratio >= 0.2) return 'medium';
  return 'low';
}

function evidence(samples, ids, max) {
  const set = new Set(ids);
  const matched = samples.filter((s) => set.has(s.event_id));
  return {
    ids: matched.slice(0, max).map((s) => s.event_id),
    examples: matched.slice(0, max).map((s) => ({
      event_id: s.event_id,
      ts: s.ts,
      tool: s.tool,
      command_shape: s.command_shape || null,
      write_path: (s.write_paths && s.write_paths[0]) || null,
      outcome_status: s.outcome_status || null,
      risk_score: s.risk_score ?? null,
    })),
  };
}

function isCommand(s) {
  return s.tool === 'Bash' || !!s.bash_intent || !!s.command_shape;
}

function commandVerb(s) {
  if (!s.command_shape) return null;
  return String(s.command_shape).trim().split(/\s+/)[0] || null;
}

function isSafeOp(s) {
  if (READONLY_TOOLS.has(s.tool)) return true;
  if (isCommand(s)) {
    if (s.bash_intent === 'readonly') return true;
    const verb = commandVerb(s);
    if (verb && SAFE_BASH_VERBS.has(verb) && SAFE_COMMAND_RE.test(s.command_shape)) return true;
  }
  return false;
}

function buildEnvelope(agentId, samples) {
  const byDecision = { allow: 0, warn: 0, require_approval: 0, block: 0 };
  const byOutcome = {};
  const toolCounts = {};
  const actionTypeCounts = {};
  const models = new Set();
  const safeTools = new Set();
  const safeVerbs = new Set();
  const safeActionTypes = new Set();
  let first = null;
  let last = null;
  let protectedTouches = 0;
  let destructive = 0;
  let failed = 0;

  for (const s of samples) {
    if (byDecision[s.guard_decision] != null) byDecision[s.guard_decision]++;
    byOutcome[s.outcome_status || 'unknown'] = (byOutcome[s.outcome_status || 'unknown'] || 0) + 1;
    toolCounts[s.tool] = (toolCounts[s.tool] || 0) + 1;
    if (s.action_type) actionTypeCounts[s.action_type] = (actionTypeCounts[s.action_type] || 0) + 1;
    if (s.model) models.add(s.model);
    if (!first || s.ts < first) first = s.ts;
    if (!last || s.ts > last) last = s.ts;
    if (s.outcome_status === 'failed') failed++;
    for (const w of s.write_paths || []) if (classifyProtectedPath(w)) protectedTouches++;
    if (isCommand(s) && (s.bash_intent === 'destructive' || s.bash_intent === 'system_admin')) destructive++;
    if (isSafeOp(s)) {
      safeTools.add(s.tool);
      const verb = commandVerb(s);
      if (verb) safeVerbs.add(verb);
      if (s.action_type) safeActionTypes.add(s.action_type);
    }
  }

  const top = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ key: k, count: v }));

  return {
    agent_id: agentId,
    agent_name: samples.find((s) => s.agent_name)?.agent_name || agentId,
    sample_size: samples.length,
    first_ts: first,
    last_ts: last,
    by_decision: byDecision,
    by_outcome: byOutcome,
    top_tools: top(toolCounts),
    top_action_types: top(actionTypeCounts),
    models: [...models],
    protected_touches: protectedTouches,
    destructive_commands: destructive,
    failed,
    safe_envelope: {
      tools: [...safeTools].sort(),
      command_verbs: [...safeVerbs].sort(),
      action_types: [...safeActionTypes].sort(),
    },
  };
}

function makeSuggestion({ type, agentId, target, rule, matchedIds, samples, opts, severity, expectedEffect, flaggedCompleted, advisoryRisk }) {
  const ev = evidence(samples, matchedIds, opts.maxEvidence);
  const matching = matchedIds.length;
  const enforceable = isEnforceable(type);
  const relevant = samples.length || 1;
  const consistency = clamp(matching / relevant, 0, 1);
  const confidence = clamp(Math.round(40 + Math.min(matching, 12) * 4 + consistency * 8), 40, 95);
  const draftRaw = behaviorRuleToGuardPolicy(rule, { agentId });
  return {
    id: suggestionSignature(type, agentId, target),
    type,
    trigger: type,
    agent_id: agentId,
    target,
    confidence,
    sample_size: samples.length,
    matching_sample_size: matching,
    evidence_event_ids: ev.ids,
    evidence_examples: ev.examples,
    expected_effect: expectedEffect,
    false_positive_risk: enforceable ? fpRisk(matching, flaggedCompleted || 0) : (advisoryRisk || 'low'),
    severity,
    enforceable,
    advisory: !enforceable,
    rule,
    draft_policy: draftRaw
      ? { name: draftRaw.name, policy_type: draftRaw.policy_type, rules: JSON.stringify(draftRaw.rules), agent_ids: draftRaw.agent_ids }
      : null,
  };
}

function analyzeAgent(agentId, samples, opts) {
  const suggestions = [];
  if (samples.length < opts.minSamples) return suggestions;

  // 1) Destructive / high-risk commands → approval (enforceable: risk_threshold)
  const destructiveSamples = samples.filter((s) => isCommand(s) && (
    s.bash_intent === 'destructive' || s.bash_intent === 'system_admin' || (Number(s.risk_score) || 0) >= DEFAULTS.destructiveRiskThreshold
  ));
  if (destructiveSamples.length >= opts.minMatch) {
    const risks = destructiveSamples.map((s) => Number(s.risk_score) || 0).filter((r) => r > 0);
    const threshold = clamp(risks.length ? Math.min(...risks) : DEFAULTS.destructiveRiskThreshold, 60, 85);
    const rule = { kind: RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL, agent_id: agentId, action: 'require_approval', risk_threshold: threshold };
    const ids = destructiveSamples.map((s) => s.event_id);
    const flaggedCompleted = destructiveSamples.filter((s) => s.outcome_status === 'completed').length;
    suggestions.push(makeSuggestion({
      type: rule.kind, agentId, target: 'high-risk / destructive commands', rule, matchedIds: ids, samples, opts,
      severity: 'high', flaggedCompleted,
      expectedEffect: `Route ${destructiveSamples.length} high-risk command(s) (risk ≥ ${threshold}) by ${agentId} through approval before execution.`,
    }));
  }

  // 2) Protected-path writes → approval (enforceable: protected_path)
  const protectedHits = [];
  const groupsTouched = new Set();
  for (const s of samples) {
    let hit = false;
    for (const w of s.write_paths || []) {
      const g = classifyProtectedPath(w);
      if (g) { groupsTouched.add(g); hit = true; }
    }
    if (hit) protectedHits.push(s);
  }
  if (protectedHits.length >= opts.minMatch && groupsTouched.size > 0) {
    const paths = [...groupsTouched].flatMap((g) => PROTECTED_PATH_GROUPS[g] || []);
    const rule = { kind: RULE_KINDS.PROTECTED_PATH_APPROVAL, agent_id: agentId, action: 'require_approval', paths };
    const ids = protectedHits.map((s) => s.event_id);
    const flaggedCompleted = protectedHits.filter((s) => s.outcome_status === 'completed').length;
    const groupList = [...groupsTouched].sort().join(', ');
    suggestions.push(makeSuggestion({
      type: rule.kind, agentId, target: groupList, rule, matchedIds: ids, samples, opts,
      severity: 'high', flaggedCompleted,
      expectedEffect: `Gate ${protectedHits.length} write(s) to protected paths (${groupList}) by ${agentId} behind approval.`,
    }));
  }

  // 3) Repeated context reloads → warn (advisory)
  const reloadRule = { kind: RULE_KINDS.REPEATED_RELOAD_WARN, agent_id: agentId, action: 'warn', max_reloads: DEFAULTS.reload.maxReloads, window_minutes: DEFAULTS.reload.windowMinutes };
  const reloadFlagged = detectReloadLoops(samples, { maxReloads: reloadRule.max_reloads, windowMinutes: reloadRule.window_minutes });
  if (reloadFlagged.size >= opts.minMatch) {
    suggestions.push(makeSuggestion({
      type: reloadRule.kind, agentId, target: 'repeated file reloads', rule: reloadRule, matchedIds: [...reloadFlagged], samples, opts,
      severity: 'medium', advisoryRisk: 'medium',
      expectedEffect: `Warn ${agentId} when the same file is re-read ${reloadRule.max_reloads}+ times within ${reloadRule.window_minutes}min without an intervening change (${reloadFlagged.size} such reads observed).`,
    }));
  }

  // 4) Repeated failed command loops → warn (advisory)
  const failRule = { kind: RULE_KINDS.FAILED_LOOP_WARN, agent_id: agentId, action: 'warn', max_failures: DEFAULTS.failure.maxFailures, window_minutes: DEFAULTS.failure.windowMinutes };
  const failFlagged = detectFailureLoops(samples, { maxFailures: failRule.max_failures, windowMinutes: failRule.window_minutes });
  if (failFlagged.size >= opts.minMatch) {
    suggestions.push(makeSuggestion({
      type: failRule.kind, agentId, target: 'repeated command failures', rule: failRule, matchedIds: [...failFlagged], samples, opts,
      severity: 'medium', advisoryRisk: 'low',
      expectedEffect: `Warn/escalate when ${agentId} repeats a failing command ${failRule.max_failures}+ times within ${failRule.window_minutes}min (${failFlagged.size} such failures observed).`,
    }));
  }

  // 5) Cheap model on heavy task → warn (advisory; needs model in samples)
  const mismatchRule = { kind: RULE_KINDS.MODEL_TASK_MISMATCH_WARN, agent_id: agentId, action: 'warn', min_tier: DEFAULTS.modelMinTier };
  const mismatchIds = samples.filter((s) => decideSample(mismatchRule, s) !== 'allow').map((s) => s.event_id);
  if (mismatchIds.length >= opts.minMatch) {
    suggestions.push(makeSuggestion({
      type: mismatchRule.kind, agentId, target: 'cheap model on heavy tasks', rule: mismatchRule, matchedIds: mismatchIds, samples, opts,
      severity: 'medium', advisoryRisk: 'medium',
      expectedEffect: `Warn ${agentId} when a below-${DEFAULTS.modelMinTier}-tier model is used for heavy work (refactor, migration, security review, multi-file debugging, architecture) — ${mismatchIds.length} such actions observed.`,
    }));
  }

  // 6) Agent allowlist of common safe operations (advisory observation)
  const envelope = buildEnvelope(agentId, samples);
  const safeIds = samples.filter(isSafeOp).map((s) => s.event_id);
  if (safeIds.length >= opts.minMatch && (envelope.safe_envelope.tools.length || envelope.safe_envelope.command_verbs.length)) {
    const allowRule = {
      kind: RULE_KINDS.AGENT_ALLOWLIST, agent_id: agentId, action: 'allow',
      allow: envelope.safe_envelope,
    };
    suggestions.push(makeSuggestion({
      type: allowRule.kind, agentId, target: 'safe operating envelope', rule: allowRule, matchedIds: safeIds, samples, opts,
      severity: 'low', advisoryRisk: 'low',
      expectedEffect: `${agentId}'s normal safe envelope: ${[...envelope.safe_envelope.tools].slice(0, 6).join(', ') || 'reads/tests/lints'}. Use to scope approval rules so routine safe work stays frictionless.`,
    }));
  }

  return suggestions;
}

function isSuppressed(suggestion, dismissals) {
  for (const d of dismissals) {
    if (d.signature && d.signature === suggestion.id) return true;
    if (d.suppress_similar && d.agent_id === suggestion.agent_id && d.type === suggestion.type) return true;
  }
  return false;
}

/**
 * Analyze samples into per-agent envelopes + suggestions.
 * @param {object[]} samples  redacted behavior samples
 * @param {object} [arg]
 * @param {object[]} [arg.dismissals]  [{signature, agent_id, type, suppress_similar}]
 * @param {object} [arg.options]       { minSamples, minMatch, maxEvidence, maxExamples }
 * @returns {{ agents:object[], suggestions:object[], dismissed:number }}
 */
export function analyzeSamples(samples, { dismissals = [], options = {} } = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const list = Array.isArray(samples) ? samples.filter((s) => s && s.event_id && s.agent_id) : [];

  const byAgent = new Map();
  for (const s of list) {
    if (!byAgent.has(s.agent_id)) byAgent.set(s.agent_id, []);
    byAgent.get(s.agent_id).push(s);
  }

  const agents = [];
  let allSuggestions = [];
  // Deterministic agent ordering.
  for (const agentId of [...byAgent.keys()].sort()) {
    const agentSamples = byAgent.get(agentId);
    agents.push(buildEnvelope(agentId, agentSamples));
    allSuggestions = allSuggestions.concat(analyzeAgent(agentId, agentSamples, opts));
  }

  let dismissedCount = 0;
  const visible = allSuggestions.filter((sug) => {
    if (isSuppressed(sug, dismissals)) { dismissedCount++; return false; }
    return true;
  });

  // Deterministic suggestion ordering: severity desc, then confidence desc, then id.
  const sevRank = { high: 3, medium: 2, low: 1 };
  visible.sort((a, b) =>
    (sevRank[b.severity] - sevRank[a.severity]) ||
    (b.confidence - a.confidence) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { agents, suggestions: visible, dismissed: dismissedCount };
}

export { DEFAULT_OPTIONS };
