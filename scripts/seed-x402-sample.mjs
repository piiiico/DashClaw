#!/usr/bin/env node

/**
 * Seed SAMPLE x402 governance data so the Spend → Overview / Purchases pages
 * render. TEST DATA ONLY — clearly marked and fully removable.
 *
 * It mirrors the real governed loop (provider + endpoint → an `x402_purchase`
 * action record → its x402_purchases detail row) so the seeded rows behave
 * exactly like real ones across Spend, Decisions, and Activity. Purchases are
 * spread across the org's REAL agents and the last 30 days, then back-dated so
 * the daily chart looks real (the aggregation buckets on x402_purchases.created_at,
 * which otherwise defaults to NOW()).
 *
 * Usage:
 *   node scripts/seed-x402-sample.mjs                 # auto-detect the active org + its agents
 *   node scripts/seed-x402-sample.mjs --org-id org_x  # target a specific org
 *   node scripts/seed-x402-sample.mjs --clear         # remove previously seeded sample data, then exit
 *
 * Idempotent: each run first clears prior sample rows (providers/endpoints
 * marked metadata.seed='sample'; actions/purchases with action_id 'act_x402seed_*')
 * and re-inserts. It never touches non-sample data.
 */

import crypto from 'node:crypto';
import './_load-env.mjs';
import { createSqlFromEnv } from './_db.mjs';
import { createProvider, createEndpoint, createPurchase } from '../app/lib/repositories/x402.repository.js';
import { createActionRecord } from '../app/lib/repositories/actions.repository.js';

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : undefined; };
const CLEAR_ONLY = args.includes('--clear');

const sql = createSqlFromEnv();

// 1. Resolve the org (most active by action count) unless overridden.
let ORG = arg('--org-id');
if (!ORG) {
  const [row] = await sql`SELECT org_id FROM action_records GROUP BY org_id ORDER BY COUNT(*) DESC LIMIT 1`;
  ORG = row?.org_id;
}
if (!ORG) { console.error('No org found (no action_records). Pass --org-id.'); process.exit(1); }
console.log('Target org:', ORG);

// 2. Clear any prior sample rows (idempotent; touches only seeded data).
await sql`DELETE FROM x402_purchases WHERE org_id = ${ORG} AND action_id LIKE 'act_x402seed_%'`;
await sql`DELETE FROM action_records WHERE org_id = ${ORG} AND action_id LIKE 'act_x402seed_%'`;
await sql`DELETE FROM x402_endpoints  WHERE org_id = ${ORG} AND metadata->>'seed' = 'sample'`;
await sql`DELETE FROM x402_providers  WHERE org_id = ${ORG} AND metadata->>'seed' = 'sample'`;
console.log('Cleared prior sample x402 data.');
if (CLEAR_ONLY) { console.log('--clear done.'); process.exit(0); }

// 3. The org's real agent fleet (this is the "run on all agents" part).
const agentRows = await sql`SELECT DISTINCT agent_id FROM action_records WHERE org_id = ${ORG} AND agent_id IS NOT NULL AND agent_id <> '' ORDER BY agent_id`;
const AGENTS = agentRows.map((r) => r.agent_id);
if (!AGENTS.length) { console.error('No agents found for org.'); process.exit(1); }
console.log(`Attributing across ${AGENTS.length} real agents: ${AGENTS.join(', ')}`);

// 4. Sample x402 capability providers (a small governed marketplace).
const PROVIDERS = [
  { name: 'Exa Search',       category: 'research', base_url: 'https://api.exa.ai',         ep: { name: 'Neural search', endpoint_url: 'https://api.exa.ai/search',                 default_price: 0.01 } },
  { name: 'Firecrawl',        category: 'scraping', base_url: 'https://api.firecrawl.dev',  ep: { name: 'Scrape',        endpoint_url: 'https://api.firecrawl.dev/v1/scrape',         default_price: 0.02 } },
  { name: 'Tavily',           category: 'search',   base_url: 'https://api.tavily.com',     ep: { name: 'Search',        endpoint_url: 'https://api.tavily.com/search',               default_price: 0.015 } },
  { name: 'Perplexity Sonar', category: 'research', base_url: 'https://api.perplexity.ai',  ep: { name: 'Answer',        endpoint_url: 'https://api.perplexity.ai/chat/completions',  default_price: 0.05 } },
];
const stock = [];
for (const p of PROVIDERS) {
  const prov = await createProvider(sql, ORG, { name: p.name, category: p.category, base_url: p.base_url, default_currency: 'USDC', metadata: { seed: 'sample' } });
  const ep = await createEndpoint(sql, ORG, prov.provider_id, { ...p.ep, category: p.category, metadata: { seed: 'sample' } });
  stock.push({ prov, ep, price: p.ep.default_price });
}
console.log(`Created ${stock.length} sample providers + endpoints.`);

// 5. Spread governed purchases across agents + the last 30 days.
const REASONS = [
  { goal: 'Find fresh sources beyond training cutoff', gap: 'No recent data on the target', value: 'Up-to-date web results' },
  { goal: 'Scrape a JS-rendered competitor page',      gap: 'Page not in context',          value: 'Structured page content' },
  { goal: 'Verify a claim against primary sources',    gap: 'Citations required',            value: 'Verified citations' },
  { goal: 'Enrich a prospect with firmographics',      gap: 'Missing headcount + funding',   value: 'Enriched record' },
];
const STATUSES = ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'pending', 'failed'];
const COUNT = Math.max(40, AGENTS.length * 3);

let made = 0;
let total = 0;
for (let i = 0; i < COUNT; i++) {
  const agent = AGENTS[i % AGENTS.length];
  const s = stock[i % stock.length];
  const reason = REASONS[i % REASONS.length];
  const status = STATUSES[i % STATUSES.length];
  const calls = 5 + ((i * 7) % 95);                 // 5..99 calls
  const spend = Math.round(s.price * calls * 100) / 100;
  const daysAgo = Math.floor((i / COUNT) * 30);     // 0..30 days back
  const ts = new Date(Date.now() - daysAgo * 86_400_000 - (i % 9) * 3_600_000).toISOString();
  const action_id = `act_x402seed_${i}_${crypto.randomUUID()}`;
  const actionStatus = status === 'pending' ? 'pending_approval' : status === 'failed' ? 'failed' : 'completed';

  await createActionRecord(sql, {
    orgId: ORG,
    action_id,
    data: {
      agent_id: agent,
      agent_name: agent,
      action_type: 'x402_purchase',
      declared_goal: reason.goal,
      reasoning: `Paid ${s.prov.name} (${calls} calls) — ${reason.goal.toLowerCase()}`,
      input_summary: reason.gap,
      risk_score: 0,
    },
    actionStatus,
    costEstimate: spend,
    signature: null,
    verified: false,
    timestamp_start: ts,
  });

  await createPurchase(sql, ORG, action_id, {
    provider_id: s.prov.provider_id,
    endpoint_id: s.ep.endpoint_id,
    agent_id: agent,
    spend_amount: spend,
    currency: 'USDC',
    payment_method: 'x402',
    purchase_reason: reason.goal,
    context_gap: reason.gap,
    expected_value: reason.value,
    execution_status: status,
    confidence_score: 0.7,
  });

  // Back-date both rows so the daily chart spreads (INSERTs default created_at to NOW()).
  await sql`UPDATE x402_purchases SET created_at = ${ts} WHERE org_id = ${ORG} AND action_id = ${action_id}`;
  await sql`UPDATE action_records SET created_at = ${ts} WHERE org_id = ${ORG} AND action_id = ${action_id}`;

  made++;
  if (status !== 'failed') total += spend;
}

console.log(`Seeded ${made} governed x402 purchases (~$${total.toFixed(2)} successful spend) across ${AGENTS.length} agents over 30 days.`);
console.log('Refresh /spend (Overview) and /spend/x402 (Purchases). Remove later with: node scripts/seed-x402-sample.mjs --clear');
process.exit(0);
