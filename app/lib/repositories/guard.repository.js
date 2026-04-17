/**
 * Guard decisions repository.
 *
 * Centralises all SQL for guard_decisions, including compat shims for
 * legacy schemas that used 'reason' instead of 'reasons', and graceful
 * handling of 42P01 (table not found) on fresh self-host installs.
 *
 * Column compat + 42P01 catch ported from Elpolini's fork
 * (elpolini/DashClaw commit dbf5463).
 */

/**
 * Introspect whether the guard_decisions table uses the 'reasons' column
 * (current schema) or the legacy 'reason' column.
 *
 * @param {object} sql - Tagged-template SQL client
 * @returns {Promise<boolean>} true if 'reasons' column exists
 */
async function hasReasonsColumn(sql) {
  const rows = await sql.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'guard_decisions' AND column_name IN ('reasons', 'reason')",
    []
  );
  return rows.some((r) => r.column_name === 'reasons');
}

/**
 * List guard decisions for an org with optional filters.
 *
 * @param {object} sql - Tagged-template SQL client with .query() method
 * @param {string} orgId
 * @param {{ agentId?: string, decision?: string, limit?: number, offset?: number }} options
 * @returns {Promise<{ decisions: Array, total: number, stats: object }>}
 */
export async function listGuardDecisions(sql, orgId, { agentId, decision, limit = 20, offset = 0 } = {}) {
  try {
    const useReasons = await hasReasonsColumn(sql);
    const reasonCol = useReasons ? 'reasons' : 'reason AS reasons';

    const conditions = ['org_id = $1'];
    const params = [orgId];

    if (agentId) {
      conditions.push(`agent_id = $${params.push(agentId)}`);
    }
    if (decision) {
      conditions.push(`decision = $${params.push(decision)}`);
    }

    const where = conditions.join(' AND ');
    const query = `
      SELECT id, org_id, agent_id, agent_name, action_type, risk_score, decision, ${reasonCol}, created_at
      FROM guard_decisions
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${params.push(limit)}
      OFFSET $${params.push(offset)}
    `;

    const countQuery = `SELECT COUNT(*) as total FROM guard_decisions WHERE ${where}`;
    const countParams = params.slice(0, conditions.length);

    const [decisions, countResult, statsRows] = await Promise.all([
      sql.query(query, params),
      sql.query(countQuery, countParams),
      sql.query(
        `SELECT
          COUNT(*) as total_24h,
          COUNT(*) FILTER (WHERE decision = 'block') as blocks_24h,
          COUNT(*) FILTER (WHERE decision = 'warn') as warns_24h,
          COUNT(*) FILTER (WHERE decision = 'require_approval') as approvals_24h
        FROM guard_decisions
        WHERE org_id = $1
          AND created_at::timestamptz > NOW() - INTERVAL '24 hours'`,
        [orgId]
      ),
    ]);

    return {
      decisions,
      total: parseInt(countResult[0]?.total || '0', 10),
      stats: statsRows[0] || {},
    };
  } catch (err) {
    // 42P01 = table not found — fresh self-host install before migration has run.
    // Return empty results instead of crashing the dashboard.
    if (err.code === '42P01') {
      return {
        decisions: [],
        total: 0,
        stats: { total_24h: 0, blocks_24h: 0, warns_24h: 0, approvals_24h: 0 },
      };
    }
    throw err;
  }
}
