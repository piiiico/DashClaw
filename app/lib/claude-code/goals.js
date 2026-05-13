/**
 * /goal outcome classifier and autopsy builder. Pure — no DB, no fs.
 *
 * Ported from AgentLens (`src/goals.js`). The original `buildAutopsyFromDb`
 * helper is dropped — the route layer is responsible for fetching messages
 * and tool_uses from the repository and calling `buildAutopsy(...)`.
 */

export const OUTCOMES = Object.freeze({
  COMPLETED: 'completed',
  THRASHED: 'thrashed',
  FELL_BACK_TO_RULES: 'fell_back_to_rules',
  TIMED_OUT: 'timed_out',
  ABORTED: 'aborted',
});

// Classify a /goal session.
// Inputs:
//   session: { cost_usd, message_count, started_at, ended_at, ... }
//   signals: {
//     goalText: string|null,
//     stuckLoops: [...],
//     toolCount: number,
//     hasFinalSummary: boolean,    // last assistant message looks like a summary
//     hasAbortSignal: boolean,     // any record contains "interrupted: true" or "abort" semantics
//     fellBackToRules: boolean,    // explicit /goal "fell back to rule list" marker
//     elapsedMs: number|null,
//     timeoutMs: number|null,
//   }
export function classifyOutcome(session, signals = {}) {
  const stuckLoops = signals.stuckLoops || [];
  const stuckLoopCount = stuckLoops.length;
  const stuckLoopTotal = stuckLoops.reduce((a, l) => a + (l.count || 0), 0);
  const toolCount = signals.toolCount || 0;
  const hasFinalSummary = !!signals.hasFinalSummary;
  const hasAbort = !!signals.hasAbortSignal;
  const fellBack = !!signals.fellBackToRules;
  const elapsed = Number(signals.elapsedMs) || null;
  const timeoutMs = Number(signals.timeoutMs) || null;

  if (fellBack) return OUTCOMES.FELL_BACK_TO_RULES;
  if (hasAbort) return OUTCOMES.ABORTED;
  if (timeoutMs && elapsed && elapsed >= timeoutMs) return OUTCOMES.TIMED_OUT;

  // Thrashed: substantial portion of tool calls are inside stuck loops AND
  // there is no terminal summary. Use ≥30% of tool calls inside loops OR
  // ≥3 stuck-loop groups in one session.
  const loopShare = toolCount > 0 ? stuckLoopTotal / toolCount : 0;
  const thrashing = (stuckLoopCount >= 3) || (loopShare >= 0.3 && !hasFinalSummary);
  if (thrashing) return OUTCOMES.THRASHED;

  if (hasFinalSummary) return OUTCOMES.COMPLETED;

  // No strong signal either way — call it completed if there was tool activity
  // and the session ended without aborting, otherwise thrashed.
  return toolCount > 0 ? OUTCOMES.COMPLETED : OUTCOMES.THRASHED;
}

// Extract a one-line goal text from a JSONL-derived signal list.
// `userTurns` is an array of user-role message text_preview strings in order.
// We look for "/goal" markers OR an explicit `signals.goalField`.
export function extractGoalText(userTurns = [], explicitField = null) {
  if (explicitField && typeof explicitField === 'string') {
    return truncateGoal(explicitField);
  }
  for (const t of userTurns) {
    if (typeof t !== 'string') continue;
    const m = t.match(/\/goal\s+(.+)/i);
    if (m) return truncateGoal(m[1]);
  }
  return null;
}

function truncateGoal(s) {
  const cleaned = String(s).replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 240) return cleaned;
  return cleaned.slice(0, 237) + '...';
}

// Categorize a list of tool names into spending buckets. Coarse on purpose —
// it should help the user reason about "where did the money go" at a glance.
export const TOOL_CATEGORY = {
  Read: 'read',
  Grep: 'read',
  Glob: 'read',
  Bash: 'shell',
  PowerShell: 'shell',
  Edit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  WebSearch: 'web',
  WebFetch: 'web',
  Agent: 'subagent',
  TaskCreate: 'planning',
  TaskUpdate: 'planning',
  TaskList: 'planning',
  TaskGet: 'planning',
  TaskStop: 'planning',
  AskUserQuestion: 'human-in-loop',
};

export function topMoneyBuckets(session, toolEvents = []) {
  if (!toolEvents.length) {
    return [
      { bucket: 'model:' + (session.model_primary || 'unknown'), share: 1, approxCost: session.cost_usd || 0 },
    ];
  }
  const counts = new Map();
  for (const e of toolEvents) {
    const cat = TOOL_CATEGORY[e.name] || 'other';
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  const total = toolEvents.length;
  const entries = [...counts.entries()].map(([cat, n]) => ({
    bucket: 'tool:' + cat,
    share: n / total,
    approxCost: (session.cost_usd || 0) * (n / total),
  }));
  entries.sort((a, b) => b.share - a.share);
  // Always include the model bucket as the first/dominant cost driver context.
  entries.unshift({ bucket: 'model:' + (session.model_primary || 'unknown'), share: 1, approxCost: session.cost_usd || 0 });
  return entries.slice(0, 4);
}

// Build a full autopsy record for one session. Caller must supply the
// pre-loaded user turns, stuck loops, and tool events (the route loads these
// from the repository).
export function buildAutopsy({
  session,
  userTurns = [],
  stuckLoops = [],
  toolEvents = [],
  hasFinalSummary = false,
  hasAbortSignal = false,
  fellBackToRules = false,
  timeoutMs = null,
}) {
  const elapsedMs = (session.started_at && session.ended_at)
    ? Math.max(0, new Date(session.ended_at).getTime() - new Date(session.started_at).getTime())
    : null;
  const outcome = classifyOutcome(session, {
    stuckLoops, toolCount: toolEvents.length, hasFinalSummary, hasAbortSignal, fellBackToRules, elapsedMs, timeoutMs,
  });
  return {
    session_id: session.id,
    session_uuid: session.session_uuid,
    goal_text: extractGoalText(userTurns),
    outcome,
    turns: session.message_count || 0,
    cost_usd: session.cost_usd || 0,
    elapsed_ms: elapsedMs,
    where_money_went: topMoneyBuckets(session, toolEvents),
  };
}
