/**
 * Learning store reads. The `decisions` table is written by POST /api/learning
 * (dashclaw_learning_log) and read back here.
 *
 * Extracted from app/api/learning/route.js so the GET handler can gain
 * server-side search (`q`) and a configurable `limit` without tripping the
 * route-sql guardrail — repositories are exempt from the route-file scope it
 * watches. Previously the MCP `dashclaw_learning_query` could only filter the
 * server's most-recent 20 decisions client-side; `q` lets it search the full
 * history server-side.
 */

/**
 * List recorded decisions for an org, newest first.
 *
 * @param {object} sql - tagged-template SQL handle
 * @param {string} orgId
 * @param {object} [opts]
 * @param {string|null} [opts.agentId] - scope to one agent
 * @param {string|null} [opts.q] - case-insensitive match on decision/context
 * @param {number} [opts.limit] - max rows (default 20, clamped 1..200)
 */
export async function listDecisions(sql, orgId, { agentId = null, q = null, limit = 20 } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
  const trimmed = q == null ? null : String(q).trim();
  const needle = trimmed ? `%${trimmed}%` : null;

  // Null params are explicitly cast — neon-serverless sends NULL untyped and
  // Postgres cannot infer the type in `IS NULL OR` contexts (42P18 otherwise).
  return sql`
    SELECT * FROM decisions
    WHERE org_id = ${orgId}
      AND (${agentId}::text IS NULL OR agent_id = ${agentId})
      AND (${needle}::text IS NULL OR decision ILIKE ${needle} OR context ILIKE ${needle})
    ORDER BY timestamp DESC
    LIMIT ${lim}
  `;
}
