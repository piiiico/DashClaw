/**
 * Usage utilities — metering and quota checking.
 *
 * Usage meters provide a fast path for tracking activity:
 * - Warm path: reads 1 row from usage_meters (no expensive COUNTs)
 * - Cold start: seeds meters from live COUNTs once per billing period
 * - Increments/decrements are fire-and-forget after mutations
 */

/** Tagged-template SQL client (callable tag returning rows). */
type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

export interface PlanLimits {
  governed_actions: number;
  actions_per_month: number;
  agents: number;
  api_keys: number;
  members: number;
  capability_invocations: number;
  workflow_executions: number;
  knowledge_collections: number;
}

/**
 * Returns the current UTC period as 'YYYY-MM'.
 */
export function getCurrentPeriod(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Plan limits by tier. Each key maps to the maximum allowed count per billing period.
 * Resources using period 'current' (agents, api_keys, members, knowledge_collections)
 * are snapshot-based; others reset monthly.
 */
// All plans are unlimited while DashClaw is open-source.
// Metering infrastructure is preserved for future monetization.
export const PLAN_LIMITS: Record<'free' | 'pro' | 'business' | 'enterprise', PlanLimits> = {
  free: {
    governed_actions: Infinity,
    actions_per_month: Infinity,
    agents: Infinity,
    api_keys: Infinity,
    members: Infinity,
    capability_invocations: Infinity,
    workflow_executions: Infinity,
    knowledge_collections: Infinity,
  },
  pro: {
    governed_actions: Infinity,
    actions_per_month: Infinity,
    agents: Infinity,
    api_keys: Infinity,
    members: Infinity,
    capability_invocations: Infinity,
    workflow_executions: Infinity,
    knowledge_collections: Infinity,
  },
  business: {
    governed_actions: Infinity,
    actions_per_month: Infinity,
    agents: Infinity,
    api_keys: Infinity,
    members: Infinity,
    capability_invocations: Infinity,
    workflow_executions: Infinity,
    knowledge_collections: Infinity,
  },
  enterprise: {
    governed_actions: Infinity,
    actions_per_month: Infinity,
    agents: Infinity,
    api_keys: Infinity,
    members: Infinity,
    capability_invocations: Infinity,
    workflow_executions: Infinity,
    knowledge_collections: Infinity,
  },
};

/**
 * Returns limits object for the given plan tier.
 * Falls back to 'free' for unknown plans.
 */
export function getPlanLimits(plan: string = 'free'): PlanLimits {
  return (PLAN_LIMITS as Record<string, PlanLimits>)[plan] || PLAN_LIMITS.free;
}

/**
 * Queries the org's current plan from the organizations table.
 */
export async function getOrgPlan(orgId: string, sql: SqlTag): Promise<string> {
  const rows = await sql`SELECT plan FROM organizations WHERE id = ${orgId} LIMIT 1`;
  return rows.length > 0 ? ((rows[0]?.plan as string) || 'free') : 'free';
}

/**
 * Atomically increment (or decrement) a usage meter.
 * Uses INSERT ... ON CONFLICT DO UPDATE for upsert semantics.
 * GREATEST(0, ...) prevents negative counters.
 *
 * @param resource - 'actions_per_month' | 'agents' | 'members' | 'api_keys'
 * @param sql - Neon SQL driver
 * @param delta - Amount to change (negative for decrements)
 */
export async function incrementMeter(
  orgId: string,
  resource: string,
  sql: SqlTag,
  delta: number = 1,
): Promise<void> {
  const period = (resource === 'members' || resource === 'api_keys')
    ? 'current'
    : getCurrentPeriod();
  const now = new Date().toISOString();

  await sql`
    INSERT INTO usage_meters (org_id, period, resource, count, updated_at)
    VALUES (${orgId}, ${period}, ${resource}, GREATEST(0, ${delta}), ${now})
    ON CONFLICT (org_id, period, resource)
    DO UPDATE SET
      count = GREATEST(0, usage_meters.count + ${delta}),
      updated_at = ${now}
  `;
}

/**
 * Seed meter rows from live COUNTs for any missing resources.
 * Uses GREATEST on upsert so concurrent seeds never under-count.
 *
 * @param period - 'YYYY-MM' for the current month
 * @param existingMap - Already-loaded meter values (resource -> count)
 * @param sql - Neon SQL driver
 */
async function seedMeters(
  orgId: string,
  period: string,
  existingMap: Map<string, number>,
  sql: SqlTag,
): Promise<Map<string, number>> {
  const periodStart = `${period}-01T00:00:00.000Z`;
  const now = new Date().toISOString();
  const missing: string[] = [];

  if (!existingMap.has('actions_per_month')) missing.push('actions_per_month');
  if (!existingMap.has('agents')) missing.push('agents');
  if (!existingMap.has('members')) missing.push('members');
  if (!existingMap.has('api_keys')) missing.push('api_keys');

  if (missing.length === 0) return existingMap;

  // Run live COUNTs only for missing resources
  const counts: Record<string, number> = {};
  const queries: Promise<void>[] = [];

  if (missing.includes('actions_per_month')) {
    queries.push(
      sql`SELECT COUNT(*)::int AS count FROM action_records
          WHERE org_id = ${orgId} AND timestamp_start::timestamptz >= ${periodStart}::timestamptz`
        .then((r) => { counts.actions_per_month = (r[0]?.count as number) || 0; })
    );
  }
  if (missing.includes('agents')) {
    queries.push(
      sql`SELECT COUNT(DISTINCT agent_id)::int AS count FROM action_records
          WHERE org_id = ${orgId} AND timestamp_start::timestamptz >= ${periodStart}::timestamptz`
        .then((r) => { counts.agents = (r[0]?.count as number) || 0; })
    );
  }
  if (missing.includes('members')) {
    queries.push(
      sql`SELECT COUNT(*)::int AS count FROM users WHERE org_id = ${orgId}`
        .then((r) => { counts.members = (r[0]?.count as number) || 0; })
    );
  }
  if (missing.includes('api_keys')) {
    queries.push(
      sql`SELECT COUNT(*)::int AS count FROM api_keys WHERE org_id = ${orgId} AND revoked_at IS NULL`
        .then((r) => { counts.api_keys = (r[0]?.count as number) || 0; })
    );
  }

  await Promise.all(queries);

  // Upsert meter rows (GREATEST prevents concurrent seeds from under-counting)
  const upserts: Promise<unknown>[] = [];
  for (const resource of missing) {
    const value = counts[resource] || 0;
    const p = (resource === 'members' || resource === 'api_keys') ? 'current' : period;
    upserts.push(
      sql`INSERT INTO usage_meters (org_id, period, resource, count, last_reconciled_at, updated_at)
          VALUES (${orgId}, ${p}, ${resource}, ${value}, ${now}, ${now})
          ON CONFLICT (org_id, period, resource)
          DO UPDATE SET
            count = GREATEST(usage_meters.count, ${value}),
            last_reconciled_at = ${now},
            updated_at = ${now}`
    );
    existingMap.set(resource, value);
  }

  await Promise.all(upserts);
  return existingMap;
}

export interface UsageCounts {
  actions_per_month: number;
  agents: number;
  members: number;
  api_keys: number;
}

/**
 * Returns current usage counts for an org from usage_meters.
 */
export async function getUsage(orgId: string, sql: SqlTag): Promise<UsageCounts> {
  const period = getCurrentPeriod();

  // Read all meter rows for this org (monthly + current snapshot)
  const rows = await sql`
    SELECT resource, count FROM usage_meters
    WHERE org_id = ${orgId}
      AND (period = ${period} OR period = 'current')
  `;

  const meterMap = new Map<string, number>();
  for (const row of rows) {
    meterMap.set(row.resource as string, row.count as number);
  }

  // Seed any missing resources from live COUNTs
  if (meterMap.size < 4) {
    await seedMeters(orgId, period, meterMap, sql);
  }

  return {
    actions_per_month: meterMap.get('actions_per_month') || 0,
    agents: meterMap.get('agents') || 0,
    members: meterMap.get('members') || 0,
    api_keys: meterMap.get('api_keys') || 0,
  };
}

export interface QuotaWarning {
  level: string;
  percentage: number;
  usage: number;
  limit: number;
  message: string;
}

export interface QuotaStatus {
  allowed: boolean;
  warning?: QuotaWarning | null;
  code?: string;
  usage?: number;
  limit?: number;
  percentage?: number;
  percent?: number;
  message?: string;
}

/**
 * Evaluates quota status for a given usage/limit pair.
 *
 * Thresholds:
 *  - <80%: allowed, no warning
 *  - 80-100%: allowed, 'approaching' warning
 *  - 100-110%: allowed, 'grace' warning (grace buffer)
 *  - >110%: blocked (quota_exceeded)
 *
 * @param usage - Current usage count
 * @param limit - Plan limit for the resource
 */
export function calculateQuotaStatus(usage: number, limit: number): QuotaStatus {
  if (limit === Infinity) {
    return { allowed: true, warning: null };
  }

  const percentage = Math.round((usage / limit) * 100);

  if (percentage < 80) {
    return { allowed: true, warning: null };
  }

  if (percentage <= 100) {
    return {
      allowed: true,
      warning: {
        level: 'approaching',
        percentage,
        usage,
        limit,
        message: `Approaching quota limit (${percentage}%). Upgrade at /billing.`,
      },
    };
  }

  if (percentage <= 110) {
    return {
      allowed: true,
      warning: {
        level: 'grace',
        percentage,
        usage,
        limit,
        message: `Quota limit exceeded (${percentage}%). Grace period active. Upgrade to continue.`,
      },
    };
  }

  return {
    allowed: false,
    code: 'quota_exceeded',
    usage,
    limit,
    percentage,
    message: 'Monthly quota exceeded. Upgrade your plan to continue.',
  };
}

/**
 * Fast quota check — reads a single usage_meters row and evaluates against plan limits.
 */
export async function checkQuotaFast(
  orgId: string,
  resource: string,
  plan: string,
  sql: SqlTag,
): Promise<QuotaStatus> {
  const limits = getPlanLimits(plan);
  // PlanLimits has fixed numeric keys; index by an arbitrary resource string.
  const limit = (limits as unknown as Record<string, number>)[resource];

  if (limit === undefined || limit === Infinity) {
    return { allowed: true, warning: null, usage: 0, limit: Infinity, percent: 0 };
  }

  const period = (resource === 'agents' || resource === 'api_keys' || resource === 'members' || resource === 'knowledge_collections')
    ? 'current'
    : getCurrentPeriod();

  const rows = await sql`
    SELECT count FROM usage_meters
    WHERE org_id = ${orgId} AND period = ${period} AND resource = ${resource}
    LIMIT 1
  `;
  const usage = rows.length > 0 ? ((rows[0]?.count as number) || 0) : 0;

  return calculateQuotaStatus(usage, limit);
}

/**
 * Checks if a specific resource is within quota.
 */
export async function checkQuota(
  orgId: string,
  resource: string,
  plan: string,
  sql: SqlTag,
): Promise<QuotaStatus> {
  return checkQuotaFast(orgId, resource, plan, sql);
}
