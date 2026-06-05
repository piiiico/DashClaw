import { getCostAggregation } from './actions.repository.js';
import { getX402SpendAggregation } from './x402.repository.js';
import { getCodeSessionSpendAggregation } from './code-sessions.repository.js';

/**
 * Read-only Fleet-lens rollup: Agent Spend (LLM token cost, x402 excluded) +
 * x402 Purchases (capability micropayments). Composes the owning repositories;
 * owns no tables of its own.
 */
export async function getFleetSpend(sql, orgId, { period = '30d' } = {}) {
  const [agent, x402] = await Promise.all([
    getCostAggregation(sql, orgId, { period }),
    getX402SpendAggregation(sql, orgId, { period }),
  ]);
  const fleet_total_usd = (agent?.total_cost_usd ?? 0) + (x402?.total_spend_usd ?? 0);
  return { lens: 'fleet', period, agent, x402, fleet_total_usd };
}

/**
 * Read-only Claude-Code-lens rollup: the operator's own Claude Code token
 * cost (advisory — `governed: false`). Composes the code-sessions repository;
 * owns no tables of its own. Cost is already billed via billing.js at ingest,
 * so this is a pure aggregation of stored `code_sessions.cost_usd`.
 */
export async function getClaudeCodeSpend(sql, orgId, { period = '30d' } = {}) {
  const code_sessions = await getCodeSessionSpendAggregation(sql, orgId, { period });
  const code_total_usd = code_sessions?.total_cost_usd ?? 0;
  return { lens: 'claude_code', period, code_sessions, code_total_usd };
}
