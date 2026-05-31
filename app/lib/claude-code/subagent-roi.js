/**
 * Subagent ROI computation. Pure — the original `buildInvocationsFromDb`
 * helper that queried sqlite is dropped; the route layer assembles
 * invocations and calls `computeRoi(invocations)`.
 *
 * Each invocation has shape:
 *   { name, cost_usd, duration_ms, success: bool|null }
 *
 * `success` may be unknown (null) — we treat unknown as "no signal" and
 * exclude it from the success-rate denominator. If all invocations are
 * unknown, the recommendation falls back to a cost-based heuristic.
 *
 * Ported from AgentLens (`src/subagent-roi.js`).
 */

export const KEEP = 'keep';
export const TRIM = 'trim';
export const DROP = 'drop';

export const SUBAGENT_NAMES = new Set([
  'Agent', 'Task', 'feature-dev:code-architect', 'feature-dev:code-explorer',
  'feature-dev:code-reviewer', 'general-purpose', 'Plan', 'Explore',
]);

export function computeRoi(invocations = []) {
  const groups = new Map();
  for (const inv of invocations) {
    const k = inv.name || 'unknown';
    const g = groups.get(k) || {
      name: k,
      invocation_count: 0,
      total_cost_usd: 0,
      total_duration_ms: 0,
      success_count: 0,
      failure_count: 0,
      unknown_count: 0,
    };
    g.invocation_count += 1;
    g.total_cost_usd += Number(inv.cost_usd) || 0;
    g.total_duration_ms += Number(inv.duration_ms) || 0;
    if (inv.success === true) g.success_count += 1;
    else if (inv.success === false) g.failure_count += 1;
    else g.unknown_count += 1;
    groups.set(k, g);
  }
  const rows = [];
  for (const g of groups.values()) {
    const avgCost = g.total_cost_usd / g.invocation_count;
    const avgDuration = g.total_duration_ms / g.invocation_count;
    const known = g.success_count + g.failure_count;
    const successRate = known > 0 ? g.success_count / known : null;
    const costPerSuccess = successRate !== null && successRate > 0
      ? g.total_cost_usd / g.success_count
      : null;
    const recommendation = recommend({
      avgCost,
      successRate,
      invocationCount: g.invocation_count,
      costPerSuccess,
    });
    rows.push({
      name: g.name,
      invocation_count: g.invocation_count,
      total_cost_usd: g.total_cost_usd,
      avg_cost_usd: avgCost,
      avg_duration_ms: avgDuration,
      success_rate: successRate,
      cost_per_success_usd: costPerSuccess,
      recommendation,
    });
  }
  rows.sort((a, b) => b.total_cost_usd - a.total_cost_usd);
  return rows;
}

// Filter raw attribution rows to subagent invocations and compute ROI. Shared
// by the subagent-roi API route and the project-page UI so the keep/trim/drop
// verdict can never differ between them. Rows are the
// listSubagentToolUseAttribution shape: { name, cost_usd, duration_ms, success }.
export function computeRoiFromRows(rows = []) {
  const invocations = rows
    .filter(r => SUBAGENT_NAMES.has(r.name))
    .map(r => ({
      name: r.name,
      cost_usd: Number(r.cost_usd) || 0,
      duration_ms: Number(r.duration_ms) || 0,
      success: r.success,
    }));
  return computeRoi(invocations);
}

export function recommend({ avgCost, successRate, invocationCount, costPerSuccess }) {
  // No signal: judge purely on cost magnitude.
  if (successRate === null) {
    if (avgCost > 0.50) return TRIM;
    return KEEP;
  }
  // High value: high success rate, low cost-per-success.
  if (successRate >= 0.8 && costPerSuccess !== null && costPerSuccess <= 1.0) return KEEP;
  // Low value: low success rate or very high cost-per-success.
  if (successRate < 0.4 || (costPerSuccess !== null && costPerSuccess >= 5.0)) return DROP;
  return TRIM;
}
