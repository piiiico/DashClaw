/**
 * Weekly memo generator. Pure — the route layer queries sessions, runs the
 * optimizer per session, deduplicates findings, and passes the pre-computed
 * data into `generateMemo(...)`.
 *
 * Ported from AgentLens (`src/memo.js`). Drops:
 *   - `writeMemoToDisk` — disk writes are CLI-only and not needed here.
 *   - The in-function DB queries — caller supplies `sessions`,
 *     `priorSessions`, `findings`, and `stuckLoopTotal`.
 */

import { cacheHitRate, formatUSD } from './pricing.js';
import { totalEstimatedMonthlySavings } from './optimizer.js';

const DEFAULT_WEEK_DAYS = 7;

/**
 * Render a Markdown memo for one project for a recent window.
 *
 * @param {Object} input
 * @param {Object} input.project          Project row, must have `slug`.
 * @param {Array}  input.sessions         Session rows in the current window.
 * @param {Array}  input.priorSessions    Session rows in the prior window.
 * @param {Array}  input.findings         Deduplicated optimizer findings.
 * @param {number} input.stuckLoopTotal   Total tool calls inside stuck loops.
 * @param {number} [input.weekDays=7]
 * @param {Date}   [input.now=new Date()]
 */
export function generateMemo({
  project,
  sessions = [],
  priorSessions = [],
  findings = [],
  stuckLoopTotal = 0,
  weekDays = DEFAULT_WEEK_DAYS,
  now = new Date(),
}) {
  if (!project || !project.slug) {
    throw new Error('generateMemo: project.slug is required');
  }

  const totalSpend = sessions.reduce((a, s) => a + (s.cost_usd || 0), 0);
  const totalCacheSavings = sessions.reduce((a, s) => a + (s.cache_savings_usd || 0), 0);

  const totalUsage = sessions.reduce((acc, s) => {
    acc.input_tokens += s.input_tokens || 0;
    acc.output_tokens += s.output_tokens || 0;
    acc.cache_read_tokens += s.cache_read_tokens || 0;
    acc.cache_creation_tokens += s.cache_creation_tokens || 0;
    return acc;
  }, { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 });

  const priorUsage = priorSessions.reduce((acc, s) => {
    acc.input_tokens += s.input_tokens || 0;
    acc.cache_read_tokens += s.cache_read_tokens || 0;
    acc.cache_creation_tokens += s.cache_creation_tokens || 0;
    return acc;
  }, { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 });

  const thisWeekHit = cacheHitRate(totalUsage);
  const priorWeekHit = cacheHitRate(priorUsage);
  const deltaPP = (thisWeekHit - priorWeekHit) * 100;

  const top3 = [...sessions].sort((a, b) => (b.cost_usd || 0) - (a.cost_usd || 0)).slice(0, 3);

  const modelsSeen = new Set(sessions.map(s => s.model_primary).filter(Boolean));
  const priorModels = new Set(priorSessions.map(s => s.model_primary).filter(Boolean));
  const newModels = [...modelsSeen].filter(m => !priorModels.has(m));

  const totalSavings = totalEstimatedMonthlySavings(findings);
  const weekTag = isoWeekTag(now);

  const lines = [];
  lines.push(`# Weekly Code Sessions memo — ${project.slug}`);
  lines.push('');
  lines.push(`**Week:** ${weekTag} (last ${weekDays} days · ${sessions.length} sessions)`);
  lines.push(`**Total spend:** ${formatUSD(totalSpend)} · **cache savings:** ${formatUSD(totalCacheSavings)}`);
  if (priorSessions.length) {
    const sign = deltaPP >= 0 ? '+' : '';
    lines.push(`**Cache hit rate:** ${(thisWeekHit * 100).toFixed(1)}% (${sign}${deltaPP.toFixed(1)} pp vs prior week)`);
  } else {
    lines.push(`**Cache hit rate:** ${(thisWeekHit * 100).toFixed(1)}% (no prior-week baseline yet)`);
  }
  lines.push('');
  lines.push('## Top 3 sessions by cost');
  if (!top3.length) {
    lines.push('_No sessions this week._');
  } else {
    for (const s of top3) {
      lines.push(`- \`${(s.session_uuid || '').slice(0, 8)}\` · ${formatUSD(s.cost_usd)} · ${s.message_count || 0} msgs · ${s.model_primary || '—'}`);
    }
  }
  lines.push('');
  lines.push('## Repeated-run signals');
  lines.push(stuckLoopTotal
    ? `Total repeated-tool-run tool calls detected this week: **${stuckLoopTotal}**. Open each session and check the confidence label before treating any as a stuck loop.`
    : 'None detected.');
  lines.push('');
  lines.push('## Optimizer findings');
  if (!findings.length) {
    lines.push('No optimizer findings this week.');
  } else {
    lines.push(`**Estimated savings if you apply all:** ${formatUSD(totalSavings)}.`);
    lines.push('');
    for (const f of findings) {
      const est = (f.estimatedMonthlySavingsUsd != null) ? ` _(est ${formatUSD(f.estimatedMonthlySavingsUsd)})_` : '';
      lines.push(`- **${f.ruleId}**: ${f.title}${est}  \n  ${f.description}  \n  → ${f.suggestedAction || ''}`);
    }
  }
  lines.push('');
  lines.push('## What changed');
  const changes = [];
  if (priorSessions.length && deltaPP <= -10) changes.push(`Cache hit rate dropped ${deltaPP.toFixed(1)} pp vs prior week.`);
  if (newModels.length) changes.push(`New model(s) observed: ${newModels.join(', ')}.`);
  if (!changes.length) changes.push('No notable changes vs prior week.');
  for (const c of changes) lines.push(`- ${c}`);
  lines.push('');
  lines.push('---');
  lines.push(`_Generated by DashClaw Code Sessions at ${now.toISOString()}._`);

  return {
    weekTag,
    markdown: lines.join('\n') + '\n',
    summary: {
      sessions: sessions.length,
      totalSpend,
      totalCacheSavings,
      thisWeekHit,
      priorWeekHit,
      deltaPP,
      stuckLoopTotal,
      findings,
      totalSavings,
    },
  };
}

export function isoWeekTag(d) {
  // Returns YYYY-Www
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const weekNum = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + (firstThursday.getUTCDay() + 6) % 7) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export function sanitizeSlug(s) {
  return String(s || 'unknown').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 80);
}
