/**
 * Guardrails Test Runs repository
 */

export async function createTestRun(sql, orgId, data) {
  const result = await sql`
    INSERT INTO guardrails_test_runs (id, org_id, total_policies, total_tests, passed, failed, success, details, triggered_by, created_at)
    VALUES (${data.id}, ${orgId}, ${data.total_policies}, ${data.total_tests}, ${data.passed}, ${data.failed}, ${data.success ? 1 : 0}, ${JSON.stringify(data.details)}, ${data.triggered_by || 'manual'}, ${new Date().toISOString()})
    RETURNING *
  `;
  return result[0];
}

export async function listTestRuns(sql, orgId, limit = 20) {
  return sql`
    SELECT * FROM guardrails_test_runs
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function getActivePolicies(sql, orgId) {
  return sql`
    SELECT * FROM guard_policies
    WHERE org_id = ${orgId} AND active = 1
    ORDER BY created_at DESC
  `;
}

export async function findPolicyByName(sql, orgId, name) {
  return sql`
    SELECT id FROM guard_policies WHERE org_id = ${orgId} AND name = ${name}
  `;
}

export async function deletePoliciesByIds(sql, orgId, idList) {
  return sql`
    DELETE FROM guard_policies
    WHERE id = ANY(${idList}) AND org_id = ${orgId}
    RETURNING id
  `;
}

export async function listGuardrailDecisions(sql, orgId, filters = {}) {
  const { decision, agentId, limit = 50, offset = 0 } = filters;

  let paramIdx = 1;
  const conditions = [`gd.org_id = $${paramIdx++}`];
  const params = [orgId];

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
    total: parseInt(countResult[0]?.total || '0', 10),
  };
}

export async function getGuardDecisionStats(sql, orgId) {
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
    blocks: parseInt(row.blocks || '0', 10),
    approvals: parseInt(row.approvals || '0', 10),
    warns: parseInt(row.warns || '0', 10),
  };
}

export async function insertPolicy(sql, orgId, { id, name, policyType, rules, agentIds, active = 1 }) {
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
  return result[0];
}
