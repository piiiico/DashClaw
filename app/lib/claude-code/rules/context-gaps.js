/**
 * CONTEXT_GAPS_DETECTED rule. Detects re-reads of the same literal-path file:
 * three reads inside the opening 10 tool calls, or five total across the
 * session. Strong signal of missing claude.md context.
 */

const ID = 'CONTEXT_GAPS_DETECTED';
export const WINDOW = 10;
export const REPEAT_THRESHOLD = 3;
export const GLOBAL_REPEAT_THRESHOLD = 5;

function isReadish(name) {
  return name === 'Read' || name === 'Grep' || name === 'Glob';
}

function looksLikeLiteralPath(target) {
  if (!target) return false;
  if (target.includes('*') || target.includes('?')) return false;
  return /[\/\\]/.test(target) || /^[A-Za-z0-9._-]+\.(?:[A-Za-z0-9]+)$/.test(target);
}

function inspect(context) {
  const events = (context && context.toolEvents) || [];
  if (events.length < REPEAT_THRESHOLD) return null;

  const earlyWindow = events.slice(0, WINDOW);
  const earlyCounts = new Map();
  const totalCounts = new Map();
  for (const ev of events) {
    if (!ev || !isReadish(ev.name)) continue;
    if (!looksLikeLiteralPath(ev.target)) continue;
    totalCounts.set(ev.target, (totalCounts.get(ev.target) || 0) + 1);
  }
  for (const ev of earlyWindow) {
    if (!ev || !isReadish(ev.name)) continue;
    if (!looksLikeLiteralPath(ev.target)) continue;
    earlyCounts.set(ev.target, (earlyCounts.get(ev.target) || 0) + 1);
  }

  const gaps = [];
  const seen = new Set();
  for (const [target, n] of earlyCounts) {
    if (n >= REPEAT_THRESHOLD) {
      gaps.push({ target, earlyCount: n, totalCount: totalCounts.get(target) || n, reason: 'early_window' });
      seen.add(target);
    }
  }
  for (const [target, n] of totalCounts) {
    if (seen.has(target)) continue;
    if (n >= GLOBAL_REPEAT_THRESHOLD) {
      gaps.push({ target, earlyCount: earlyCounts.get(target) || 0, totalCount: n, reason: 'global' });
    }
  }
  if (!gaps.length) return null;

  gaps.sort((a, b) => (b.totalCount - a.totalCount) || (b.earlyCount - a.earlyCount));

  const exemplar = gaps[0];
  const fileList = gaps.slice(0, 6).map(g => `${g.target} (×${g.totalCount})`).join(', ');

  return {
    ruleId: ID,
    severity: 'warn',
    title: `Context gap: ${gaps.length} file${gaps.length === 1 ? '' : 's'} re-read repeatedly — generate claude.md`,
    description: `The agent re-read ${exemplar.target} ${exemplar.totalCount} times this session (first ${exemplar.earlyCount} occurrences inside the opening ${WINDOW} tool calls). When the same files are re-read at session start, the agent is searching for context it should have been given up front. Files: ${fileList}.`,
    suggestedAction: 'Generate a claude.md for this project from this session. AgentLens will pull the most-read files, their exports, types, and conventions, and produce a markdown context file you drop into the project root. The next session starts loaded.',
    estimatedMonthlySavingsUsd: null,
    evidence: { gaps, window: WINDOW, threshold: REPEAT_THRESHOLD, globalThreshold: GLOBAL_REPEAT_THRESHOLD },
    actionable: { kind: 'generate_claude_md' },
  };
}

const RULE = { id: ID, inspect };
export default RULE;
