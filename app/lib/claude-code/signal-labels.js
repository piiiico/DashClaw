/**
 * Human-friendly labels and one-line "what / what to do" hints for the
 * 7 optimizer rule kinds + the repeated_run cluster. Used by the session
 * detail page to replace SCREAMING_SNAKE_CASE rule ids with readable
 * titles. The rule's own `payload.title` / `payload.description` carry
 * the specific finding for this session; this file owns the static
 * label + action for the kind itself.
 */

export const SIGNAL_LABELS = {
  MODEL_DOWNSHIFT: {
    label: 'Model overkill',
    tone: 'cost',
    suggestion: 'Try Sonnet for sessions like this — Opus output volume was modest.',
  },
  CACHE_WRITE_BLOAT: {
    label: 'Cache write churn',
    tone: 'cost',
    suggestion: 'Reduce churn in CLAUDE.md / AGENTS.md / SOUL.md — they invalidate the cache every turn.',
  },
  STUCK_LOOP_COST: {
    label: 'Stuck loop',
    tone: 'cost',
    suggestion: 'High-confidence repeated tool runs absorbed a large share of spend.',
  },
  SUBAGENT_PROMPT_BLOAT: {
    label: 'Subagent prompt bloat',
    tone: 'cost',
    suggestion: 'Subagent calls share a large prefix — extract it into a parent skill.',
  },
  REPEATED_READ_CYCLES: {
    label: 'Read → Edit → Read cycles',
    tone: 'flow',
    suggestion: 'The agent edited without a plan. Add a planning step or a tighter file scope.',
  },
  BAD_CACHE_HIT: {
    label: 'Low cache hit rate',
    tone: 'flow',
    suggestion: 'Recent sessions are missing cache. Check for unstable instruction files.',
  },
  CONTEXT_GAPS_DETECTED: {
    label: 'Context gaps',
    tone: 'flow',
    suggestion: 'Files were re-read during session opening. Pre-load them via CLAUDE.md.',
  },
  repeated_run: {
    label: 'Repeated tool runs',
    tone: 'noise',
    suggestion: 'Tools invoked multiple times on the same target. High confidence = candidate cache hits.',
  },
};

export function labelFor(kind) {
  return SIGNAL_LABELS[kind] || { label: kind, tone: 'flow', suggestion: '' };
}

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

export function severityRank(sig) {
  const conf = CONFIDENCE_RANK[sig.confidence] || 0;
  const savings = Number(sig.savings_usd) || 0;
  // Savings dominate when present, then confidence breaks ties.
  return savings * 10 + conf;
}
