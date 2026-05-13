/**
 * REPEATED_READ_CYCLES rule. Detects Read|Grep → Edit → Read|Grep cycles on
 * the same target, repeated ≥ CYCLE_THRESHOLD times.
 */

const ID = 'REPEATED_READ_CYCLES';
export const CYCLE_THRESHOLD = 3;

function inspect(context) {
  const events = (context && context.toolEvents) || [];
  if (events.length < 3) return null;

  const cyclesByTarget = new Map();
  for (let i = 0; i + 2 < events.length; i++) {
    const a = events[i];
    const b = events[i + 1];
    const c = events[i + 2];
    if (!a || !b || !c) continue;
    if ((a.name === 'Read' || a.name === 'Grep') && b.name === 'Edit' && (c.name === 'Read' || c.name === 'Grep')) {
      const key = a.target || b.target || c.target || '_anonymous_';
      cyclesByTarget.set(key, (cyclesByTarget.get(key) || 0) + 1);
    }
  }
  const offenders = [];
  for (const [target, count] of cyclesByTarget) {
    if (count >= CYCLE_THRESHOLD) offenders.push({ target, count });
  }
  if (!offenders.length) return null;

  return {
    ruleId: ID,
    severity: 'warn',
    title: `${offenders.length} file(s) saw repeated Read→Edit→Read cycles`,
    description: `Three or more iterative Read→Edit→Read cycles on the same target suggest the agent is editing without a plan. Files: ${offenders.map(o => `${o.target} (×${o.count})`).join(', ')}.`,
    suggestedAction: 'Checkpoint a plan first: list the exact edits, then apply them in one pass. The Read→Edit→Read pattern usually means the agent is searching for context it should have been given up front.',
    estimatedMonthlySavingsUsd: null,
    evidence: { offenders, threshold: CYCLE_THRESHOLD },
  };
}

const RULE = { id: ID, inspect };
export default RULE;
