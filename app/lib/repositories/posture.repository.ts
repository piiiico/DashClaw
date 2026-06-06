/**
 * Posture repository — READ-ONLY queries that feed the governance posture
 * score engine. No writes; no new tables (Task 7 scope). Snapshots are Task 8+.
 *
 * All functions take `sql: SqlTag` as the first argument (tagged-template client)
 * and `orgId: string` as the second, matching the house repository pattern.
 */

import type { SqlTag } from '../types/db';
import { bucketRiskScore } from '../posture/model';
import type { GovernableUnit, RiskLevel, Dimension } from '../posture/types';

// ─────────────────────────────────────────────────────────────────────────────
// Row types (untrusted DB rows; shaped before use)
// ─────────────────────────────────────────────────────────────────────────────

interface CapabilityPostureRow {
  slug: unknown;
  name: unknown;
  category: unknown;
  source_type: unknown;
  risk_level: unknown;
  requires_approval: unknown;
  pricing_json: unknown;
  [k: string]: unknown;
}

interface ActionTypeRow {
  action_type: unknown;
  risk_score_avg: unknown;
  observed_count: unknown;
  reversible_any: unknown;
  systems_touched_sample: unknown;
  has_cost: unknown;
  [k: string]: unknown;
}

interface IdentityBoundRow {
  agent_id: unknown;
  [k: string]: unknown;
}

interface X402ProviderPostureRow {
  provider_id: unknown;
  slug: unknown;
  [k: string]: unknown;
}

interface DecisionRow {
  action_id: unknown;
  risk_score: unknown;
  action_type: unknown;
  outcome_status: unknown;
  created_at: unknown;
  [k: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const RISK_LEVELS = new Set<string>(['low', 'medium', 'high', 'critical']);

function toRiskLevel(v: unknown): RiskLevel {
  return RISK_LEVELS.has(String(v)) ? (v as RiskLevel) : 'medium';
}

/** Map a capability category to its primary posture dimension. */
function capabilityDimension(category: unknown, sourceType: unknown): Dimension {
  const cat = String(category || '').toLowerCase();
  const src = String(sourceType || '').toLowerCase();
  if (cat === 'identity' || cat === 'auth' || cat === 'authentication') return 'identity';
  if (cat === 'spend' || cat === 'payments' || cat === 'billing' || src === 'external_marketplace') return 'spend';
  if (cat === 'data' || cat === 'storage' || cat === 'database') return 'data_protection';
  if (cat === 'approval' || cat === 'review') return 'approval';
  if (cat === 'logging' || cat === 'audit' || cat === 'monitoring') return 'auditability';
  return 'enforcement';
}

/** Map an action_type string to its primary posture dimension. */
function actionTypeDimension(actionType: string): Dimension {
  const t = actionType.toLowerCase();
  if (t === 'deploy' || t === 'apply' || t === 'migrate' || t === 'security') return 'enforcement';
  if (t === 'api' || t === 'sync' || t === 'post' || t === 'message') return 'data_protection';
  if (t === 'monitor' || t === 'alert' || t === 'review') return 'auditability';
  return 'enforcement';
}

function hasPricing(pricingJson: unknown): boolean {
  if (!pricingJson || pricingJson === '{}') return false;
  if (typeof pricingJson === 'string') {
    try {
      const p = JSON.parse(pricingJson);
      return typeof p === 'object' && p !== null && Object.keys(p).length > 0;
    } catch { return false; }
  }
  if (typeof pricingJson === 'object') return Object.keys(pricingJson as object).length > 0;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported query functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a GovernableUnit for each capability registered for this org.
 * observedCount is 0 here; it gets merged with observed-action units in signals.ts.
 */
export async function getCapabilityUnits(
  sql: SqlTag,
  orgId: string,
): Promise<GovernableUnit[]> {
  const rows = await sql`
    SELECT slug, name, category, source_type, risk_level, requires_approval, pricing_json
    FROM capabilities
    WHERE org_id = ${orgId}
    ORDER BY updated_at DESC
  `;
  return (rows as CapabilityPostureRow[]).map((r): GovernableUnit => {
    const isExternal = String(r.source_type || '').includes('external') ||
      String(r.source_type || '').includes('marketplace');
    return {
      key: String(r.slug || r.name || 'unknown'),
      surfaceType: 'capability',
      riskLevel: toRiskLevel(r.risk_level),
      reversible: true, // capabilities don't have a per-capability reversible flag; default safe
      hasSpendExposure: hasPricing(r.pricing_json) || isExternal,
      requiresApproval: r.requires_approval === 1 || r.requires_approval === true,
      observedCount: 0,
      dimension: capabilityDimension(r.category, r.source_type),
    };
  });
}

/**
 * Aggregates action_records by action_type to produce GovernableUnit entries.
 * Risk level is bucketed from the average risk_score. observedCount = row count.
 */
export async function getObservedActionUnits(
  sql: SqlTag,
  orgId: string,
): Promise<GovernableUnit[]> {
  const rows = await sql`
    SELECT
      action_type,
      AVG(risk_score)::real             AS risk_score_avg,
      COUNT(*)::int                     AS observed_count,
      MAX(CASE WHEN reversible = false OR reversible = 0 THEN 1 ELSE 0 END)::int AS reversible_any,
      MAX(systems_touched)              AS systems_touched_sample,
      MAX(CASE WHEN cost_estimate > 0 THEN 1 ELSE 0 END)::int AS has_cost
    FROM action_records
    WHERE org_id = ${orgId}
      AND action_type IS NOT NULL
      AND action_type <> ''
    GROUP BY action_type
    ORDER BY observed_count DESC
  `;
  return (rows as ActionTypeRow[]).map((r): GovernableUnit => {
    const avgRisk = Number(r.risk_score_avg) || 0;
    const irreversible = Number(r.reversible_any) === 1;
    return {
      key: `action_type:${String(r.action_type)}`,
      surfaceType: 'action_type',
      riskLevel: bucketRiskScore(avgRisk),
      reversible: !irreversible,
      hasSpendExposure: Number(r.has_cost) === 1,
      requiresApproval: false, // no declared intent; coverage comes from policies
      observedCount: Number(r.observed_count) || 0,
      dimension: actionTypeDimension(String(r.action_type)),
    };
  });
}

/**
 * Returns recent guard_decisions that reached 'allow' despite high/critical risk
 * (ungoverned high-risk actions — incident candidates for the adjustments).
 * sinceTs: ISO timestamp; default 7-day window.
 */
export async function getRecentDecisions(
  sql: SqlTag,
  orgId: string,
  sinceTs: string,
): Promise<DecisionRow[]> {
  const rows = await sql`
    SELECT action_id, risk_score, action_type, outcome_status, created_at
    FROM guard_decisions
    WHERE org_id = ${orgId}
      AND decision = 'allow'
      AND risk_score >= 50
      AND created_at::timestamptz > ${sinceTs}::timestamptz
    ORDER BY created_at DESC
    LIMIT 100
  `;
  return rows as DecisionRow[];
}

/**
 * Returns distinct agent_ids that have been explicitly bound (i.e. appear in
 * guard_policies' agent_ids scope, meaning an operator has targeted them).
 * Used to compute the identity-binding coverage dimension.
 */
export async function getIdentityBoundAgents(
  sql: SqlTag,
  orgId: string,
): Promise<IdentityBoundRow[]> {
  const rows = await sql`
    SELECT DISTINCT jsonb_array_elements_text(agent_ids::jsonb) AS agent_id
    FROM guard_policies
    WHERE org_id = ${orgId}
      AND active = 1
      AND agent_ids IS NOT NULL
      AND agent_ids <> 'null'
      AND agent_ids <> '[]'
  `;
  return rows as IdentityBoundRow[];
}

/**
 * Returns active x402 providers for this org — each represents a spend-exposed
 * surface. Used by signals.ts to set hasSpendExposure on matching units.
 */
export async function getX402SpendSurfaces(
  sql: SqlTag,
  orgId: string,
): Promise<X402ProviderPostureRow[]> {
  const rows = await sql`
    SELECT provider_id, slug
    FROM x402_providers
    WHERE org_id = ${orgId}
      AND status = 'active'
    ORDER BY created_at DESC
  `;
  return rows as X402ProviderPostureRow[];
}
