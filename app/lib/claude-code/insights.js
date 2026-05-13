/**
 * Session-level insight functions: stuck-loop detection, cost anomaly check,
 * cache health flag.
 *
 * Distinct from `repeated-runs.js` which produces confidence-labelled signals.
 * `detectStuckLoops` here is a simpler counter-based helper kept for callers
 * that don't need the full confidence model. New code should prefer
 * `detectRepeatedRuns` from `./repeated-runs.js`.
 *
 * Ported from AgentLens (`src/insights.js`) — CommonJS → ESM. Pure.
 */

import { cacheHitRate } from './pricing.js';

export const STUCK_LOOP_THRESHOLD = 3;
export const COST_ANOMALY_MULTIPLE = 3;
export const CACHE_HEALTH_FLOOR = 0.30;

export function detectStuckLoops(toolUses, threshold = STUCK_LOOP_THRESHOLD) {
  const loops = [];
  let runName = null;
  let runStart = -1;

  for (let i = 0; i < toolUses.length; i++) {
    const t = toolUses[i];
    if (t.name === runName) continue;
    if (runName && (i - runStart) >= threshold) {
      loops.push({ name: runName, count: i - runStart, startIndex: runStart, endIndex: i - 1 });
    }
    runName = t.name;
    runStart = i;
  }
  if (runName && (toolUses.length - runStart) >= threshold) {
    loops.push({ name: runName, count: toolUses.length - runStart, startIndex: runStart, endIndex: toolUses.length - 1 });
  }
  return loops;
}

export function detectCostAnomalies(currentCost, priorCosts, multiple = COST_ANOMALY_MULTIPLE) {
  if (!priorCosts || priorCosts.length < 3) {
    return { flagged: false, reason: 'insufficient_history' };
  }
  const sorted = [...priorCosts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0) return { flagged: false, reason: 'median_zero' };
  const ratio = currentCost / median;
  return {
    flagged: ratio >= multiple,
    ratio,
    median,
    reason: ratio >= multiple ? 'cost_anomaly' : 'within_band',
  };
}

export function cacheHealth(totals) {
  const rate = cacheHitRate(totals);
  return {
    rate,
    flagged: rate < CACHE_HEALTH_FLOOR,
    note: rate < CACHE_HEALTH_FLOOR
      ? `Cache hit rate ${(rate * 100).toFixed(1)}% — below ${(CACHE_HEALTH_FLOOR * 100).toFixed(0)}% floor.`
      : `Cache hit rate ${(rate * 100).toFixed(1)}% — healthy.`,
  };
}

export function summarizeInsights({ toolUses = [], currentCost = 0, priorCosts = [], totals = {} } = {}) {
  return {
    stuck_loops: detectStuckLoops(toolUses),
    cost_anomaly: detectCostAnomalies(currentCost, priorCosts),
    cache_health: cacheHealth(totals),
  };
}
