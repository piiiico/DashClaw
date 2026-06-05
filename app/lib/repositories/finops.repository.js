import { getCostAggregation } from './actions.repository.js';
import { getX402SpendAggregation } from './x402.repository.js';

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
