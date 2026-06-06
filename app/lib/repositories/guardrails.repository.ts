/**
 * Guardrails Test Runs repository
 */

import type { SqlTag } from '../types/db.js';

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

interface CreateTestRunData {
  id: string;
  total_policies: number;
  total_tests: number;
  passed: number;
  failed: number;
  success: boolean;
  details: unknown;
  triggered_by?: string;
  [k: string]: unknown;
}

interface GuardrailDecisionFilters {
  decision?: string;
  agentId?: string;
  limit?: number;
  offset?: number;
}

interface InsertPolicyData {
  id: string;
  name: string;
  policyType: string;
  rules: unknown;
  agentIds?: unknown;
  active?: number;
}

export async function createTestRun(
  sql: SqlTag,
  orgId: string,
  data: CreateTestRunData
): Promise<Record<string, unknown> | null> {
  const result = await sql`
    INSERT INTO guardrails_test_runs (id, org_id, total_policies, total_tests, passed, failed, success, details, triggered_by, created_at)
    VALUES (${data.id}, ${orgId}, ${data.total_policies}, ${data.total_tests}, ${data.passed}, ${data.failed}, ${data.success ? 1 : 0}, ${JSON.stringify(data.details)}, ${data.triggered_by || 'manual'}, ${new Date().toISOString()})
    RETURNING *
  `;
  return result[0] ?? null;
}

export async function listTestRuns(
  sql: SqlTag,
  orgId: string,
  limit = 20
): Promise<Record<string, unknown>[]> {
  return sql`
    SELECT * FROM guardrails_test_runs
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function getActivePolicies(
  sql: SqlTag,
  orgId: string
): Promise<Record<string, unknown>[]> {
  return sql`
    SELECT * FROM guard_policies
    WHERE org_id = ${orgId} AND active = 1
    ORDER BY created_at DESC
  `;
}

export async function findPolicyByName(
  sql: SqlTag,
  orgId: string,
  name: string
): Promise<Record<string, unknown>[]> {
  return sql`
    SELECT id FROM guard_policies WHERE org_id = ${orgId} AND name = ${name}
  `;
}

export async function deletePoliciesByIds(
  sql: SqlTag,
  orgId: string,
  idList: string[]
): Promise<Record<string, unknown>[]> {
  return sql`
    DELETE FROM guard_policies
    WHERE id = ANY(${idList}) AND org_id = ${orgId}
    RETURNING id
  `;
}

export async function listGuardrailDecisions(
  sql: SqlClient,
  orgId: string,
  filters: GuardrailDecisionFilters = {}
): Promise<{ decisions: Record<string, unknown>[]; total: number }> {
  const { decision, agentId, limit = 50, offset = 0 } = filters;

  let paramIdx = 1;
  const conditions = [`gd.org_id = $${paramIdx++}`];
  const params: unknown[] = [orgId];

  if (decision) {
    conditions.push(`gd.decision = $${paramIdx++}`);
    params.push(decision);
  }
  if (agentId) {
    conditions.push(`gd.agent_id = $${paramIdx++}`);
    params.push(agentId);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const decisionsQuery = `
    SELECT gd.id, gd.decision, gd.risk_score, gd.agent_id, gd.action_type,
           gd.reason, gd.matched_policies, gd.context, gd.created_at,
           gd.verification_status, gd.replay_status, gd.act_status
    FROM guard_decisions gd
    ${where}
    ORDER BY gd.created_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;
  params.push(limit, offset);

  const countQuery = `SELECT COUNT(*)::int AS total FROM guard_decisions gd ${where}`;
  const countParams = params.slice(0, -2);

  const [decisions, countResult] = await Promise.all([
    sql.query(decisionsQuery, params),
    sql.query(countQuery, countParams),
  ]);

  return {
    decisions: decisions || [],
    total: parseInt((countResult[0]?.total as string | undefined) || '0', 10),
  };
}

export async function getGuardDecisionStats(
  sql: SqlClient,
  orgId: string
): Promise<{ blocks: number; approvals: number; warns: number }> {
  const result = await sql.query(
    `SELECT
      COUNT(*) FILTER (WHERE decision = 'block')::int AS blocks,
      COUNT(*) FILTER (WHERE decision = 'require_approval')::int AS approvals,
      COUNT(*) FILTER (WHERE decision = 'warn')::int AS warns
    FROM guard_decisions
    WHERE org_id = $1 AND created_at::timestamptz > NOW() - INTERVAL '7 days'`,
    [orgId]
  );
  const row = result[0] || {};
  return {
    blocks: parseInt((row.blocks as string | undefined) || '0', 10),
    approvals: parseInt((row.approvals as string | undefined) || '0', 10),
    warns: parseInt((row.warns as string | undefined) || '0', 10),
  };
}

export async function insertPolicy(
  sql: SqlTag,
  orgId: string,
  { id, name, policyType, rules, agentIds, active = 1 }: InsertPolicyData
): Promise<Record<string, unknown> | null> {
  // `active` defaults to 1 to preserve existing callers. Behavior Learning
  // adoption passes active=0 so a suggested draft never auto-enforces — the
  // operator activates it later from the Policies surface.
  const activeFlag = active ? 1 : 0;
  const now = new Date().toISOString();
  const result = await sql`
    INSERT INTO guard_policies (id, org_id, name, policy_type, rules, active, agent_ids, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${name}, ${policyType}, ${rules}, ${activeFlag}, ${agentIds || null}, ${now}, ${now})
    RETURNING *
  `;
  return result[0] ?? null;
}
