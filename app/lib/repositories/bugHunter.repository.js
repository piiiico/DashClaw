/**
 * Bug Hunter repository — data-access layer for bug_hunter_scans table.
 * Route-sql guardrail: routes import from here instead of writing SQL directly.
 */

// Postgres error code 42P01 = undefined_table. Distinguish "table not yet
// created" (graceful degrade to empty result) from real DB failures
// (transient outage, permissions, OOM) which must propagate so they surface
// in alerting instead of presenting as silently-empty data.
function isMissingTable(err) {
  return err?.code === '42P01' || /relation .* does not exist/i.test(err?.message || '');
}

export async function listScans(sql, orgId, limit = 50) {
  try {
    return await sql`
      SELECT scan_id, agent_id, scope, status, findings_count, created_at
      FROM bug_hunter_scans
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export async function getScanStats(sql, orgId) {
  try {
    const rows = await sql`
      SELECT
        COUNT(*)::int AS total_scans,
        COALESCE(SUM(findings_count), 0)::int AS issues_found,
        COALESCE(SUM(resolved_count), 0)::int AS resolved,
        COALESCE(SUM(findings_count) - SUM(resolved_count), 0)::int AS open
      FROM bug_hunter_scans
      WHERE org_id = ${orgId}
    `;
    return rows[0] || { total_scans: 0, issues_found: 0, resolved: 0, open: 0 };
  } catch (err) {
    if (isMissingTable(err)) {
      return { total_scans: 0, issues_found: 0, resolved: 0, open: 0 };
    }
    throw err;
  }
}

export async function insertScan(sql, orgId, { scanId, agentId, scope, findingsCount }) {
  try {
    await sql`
      INSERT INTO bug_hunter_scans (scan_id, org_id, agent_id, scope, status, findings_count, resolved_count, created_at)
      VALUES (${scanId}, ${orgId}, ${agentId}, ${scope}, 'completed', ${findingsCount}, 0, NOW())
    `;
    return true;
  } catch (err) {
    if (isMissingTable(err)) return false;
    throw err;
  }
}
