/**
 * STUCK_LOOP_COST rule. Fires only on HIGH-confidence repeated runs
 * (multi-request, same target). The usage block in JSONL is per assistant
 * message, not per tool call, so we can only estimate proportional cost.
 */

const ID = 'STUCK_LOOP_COST';

function inspect(context) {
  const session = context && context.session;
  const loops = (context && context.stuckLoops) || [];
  if (!session || !loops.length) return null;
  const toolCount = (context && context.toolCount) || 0;
  if (toolCount === 0) return null;

  const loopLen = loops.reduce((acc, l) => acc + (l.count || 0), 0);
  if (loopLen === 0) return null;
  const share = Math.min(1, loopLen / toolCount);
  const cost = (session.cost_usd || 0) * share;
  if (cost <= 0) return null;

  const evidenceSummary = loops.map(l => `${l.name}×${l.count}` + (l.requestSpread ? ` (${l.requestSpread} requests)` : '')).join(', ');

  return {
    ruleId: ID,
    severity: 'warn',
    title: `Repeated tool-run signal: approx ~$${cost.toFixed(2)} this session`,
    description: `${loops.length} HIGH-confidence repeated-run(s) covering ${loopLen} of ${toolCount} tool calls (${(share * 100).toFixed(1)}%). Approx ~$${cost.toFixed(2)} of session spend sat inside these repeats — this is a proportional estimate, not a measured cost.`,
    suggestedAction: 'Tighten the goal completion condition or add a hook that detects N-in-a-row identical tool calls across model requests and forces a checkpoint. Signals: ' + evidenceSummary + '.',
    estimatedMonthlySavingsUsd: cost,
    estimateConfidence: 'high',
    estimateMethod: 'proportional_share',
    evidence: { loops, loopLen, toolCount, share, sessionCost: session.cost_usd || 0 },
  };
}

const RULE = { id: ID, inspect };
export default RULE;
