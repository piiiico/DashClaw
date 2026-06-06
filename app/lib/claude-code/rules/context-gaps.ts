/**
 * CONTEXT_GAPS_DETECTED rule. Detects re-reads of the same literal-path file:
 * three reads inside the opening 10 tool calls, or five total across the
 * session. Strong signal of missing claude.md context.
 */

const ID = 'CONTEXT_GAPS_DETECTED';
export const WINDOW = 10;
export const REPEAT_THRESHOLD = 3;
export const GLOBAL_REPEAT_THRESHOLD = 5;

interface ToolEvent {
  name?: string;
  target?: string | null;
}

interface InspectContext {
  toolEvents?: ToolEvent[];
}

interface ContextGap {
  target: string;
  earlyCount: number;
  totalCount: number;
  reason: 'early_window' | 'global';
}

interface ContextGapFinding {
  ruleId: string;
  severity: string;
  title: string;
  description: string;
  suggestedAction: string;
  estimatedMonthlySavingsUsd: number | null;
  evidence: {
    gaps: ContextGap[];
    window: number;
    threshold: number;
    globalThreshold: number;
  };
  actionable: { kind: string };
}

interface Rule {
  id: string;
  inspect: (context: InspectContext | null | undefined) => ContextGapFinding | null;
}

function isReadish(name: string | undefined): boolean {
  return name === 'Read' || name === 'Grep' || name === 'Glob';
}

function looksLikeLiteralPath(target: string | null | undefined): boolean {
  if (!target) return false;
  if (target.includes('*') || target.includes('?')) return false;
  return /[\/\\]/.test(target) || /^[A-Za-z0-9._-]+\.(?:[A-Za-z0-9]+)$/.test(target);
}

function inspect(context: InspectContext | null | undefined): ContextGapFinding | null {
  const events = (context && context.toolEvents) || [];
  if (events.length < REPEAT_THRESHOLD) return null;

  const earlyWindow = events.slice(0, WINDOW);
  const earlyCounts = new Map<string, number>();
  const totalCounts = new Map<string, number>();
  for (const ev of events) {
    if (!ev || !isReadish(ev.name)) continue;
    if (!looksLikeLiteralPath(ev.target)) continue;
    const target = ev.target as string;
    totalCounts.set(target, (totalCounts.get(target) || 0) + 1);
  }
  for (const ev of earlyWindow) {
    if (!ev || !isReadish(ev.name)) continue;
    if (!looksLikeLiteralPath(ev.target)) continue;
    const target = ev.target as string;
    earlyCounts.set(target, (earlyCounts.get(target) || 0) + 1);
  }

  const gaps: ContextGap[] = [];
  const seen = new Set<string>();
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

  const exemplar = gaps[0]!;
  const fileList = gaps.slice(0, 6).map((g) => `${g.target} (×${g.totalCount})`).join(', ');

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

const RULE: Rule = { id: ID, inspect };
export default RULE;
