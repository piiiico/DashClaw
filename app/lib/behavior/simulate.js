/**
 * Replay a behavior rule against recorded samples and count the decisions it
 * would have produced. This powers the mandatory simulation-before-adopt gate
 * in the Policy Coach. Deterministic; uses the same evaluator as the analyzer.
 */

import { evaluateRuleOverSamples, RULE_KINDS, tsMs } from './policy-model.js';

const MAX_EXAMPLES = 12;

/**
 * @param {object} rule   a behavior rule (see policy-model RULE_KINDS)
 * @param {object[]} samples
 * @returns {{
 *   total:number, allow:number, warn:number, require_approval:number, block:number,
 *   flagged:number, likely_false_positives:number, allowlist_covered:number,
 *   examples:Array<object>
 * }}
 */
export function simulateBehaviorPolicy(rule, samples) {
  const list = Array.isArray(samples) ? samples : [];
  const { decisions, allowlistCovered } = evaluateRuleOverSamples(rule, list);

  const counts = { total: list.length, allow: 0, warn: 0, require_approval: 0, block: 0 };
  let flagged = 0;
  let likelyFalsePositives = 0;
  const examples = [];
  const byId = new Map(list.map((s) => [s.event_id, s]));

  for (const [eventId, decision] of decisions) {
    counts[decision] = (counts[decision] || 0) + 1;
    if (decision === 'allow') continue;
    flagged++;
    const sample = byId.get(eventId);
    // A flagged-but-successful action is a likely false positive for gating
    // rules: enforcement would have added friction to an action that completed
    // fine. Warn-only rules don't block, so their friction cost is treated as 0.
    if ((decision === 'require_approval' || decision === 'block') && sample && sample.outcome_status === 'completed') {
      likelyFalsePositives++;
    }
    if (examples.length < MAX_EXAMPLES && sample) {
      examples.push({
        event_id: eventId,
        decision,
        ts: sample.ts,
        tool: sample.tool,
        command_shape: sample.command_shape || null,
        write_path: (sample.write_paths && sample.write_paths[0]) || null,
        outcome_status: sample.outcome_status || null,
        risk_score: sample.risk_score ?? null,
      });
    }
  }

  examples.sort((a, b) => tsMs(b) - tsMs(a));

  return {
    total: counts.total,
    allow: counts.allow,
    warn: counts.warn,
    require_approval: counts.require_approval,
    block: counts.block,
    flagged,
    likely_false_positives: likelyFalsePositives,
    allowlist_covered: rule.kind === RULE_KINDS.AGENT_ALLOWLIST ? allowlistCovered : 0,
    examples,
  };
}
