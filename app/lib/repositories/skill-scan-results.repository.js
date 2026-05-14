/**
 * Repository for skill_scan_results — cached static-safety scan results for
 * skill content, keyed by (org_id, skill_name, target_hash).
 *
 * The dedupe constraint on (org_id, skill_name, target_hash) means re-scanning
 * the same skill content for the same org just upserts the existing row instead
 * of inserting a duplicate.
 *
 * Follows the existing repository pattern: every function takes
 * `(sql, orgId, ...)`, SQL is written as tagged templates, no raw
 * concatenation.
 */
import { randomBytes } from 'node:crypto';

function scanId() {
  return 'scn_' + randomBytes(8).toString('hex');
}

/**
 * Return the cached scan row for (orgId, skillName, targetHash) or null.
 * Callers use this to skip re-running the scanner when content hasn't changed.
 */
export async function getCachedScan(sql, orgId, skillName, targetHash) {
  const rows = await sql`
    SELECT id, org_id, skill_name, target_hash, findings, passed, created_at
    FROM skill_scan_results
    WHERE org_id = ${orgId} AND skill_name = ${skillName} AND target_hash = ${targetHash}
    LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Insert a scan result, or update the existing row's findings/passed on
 * (org_id, skill_name, target_hash) conflict. Returns the inserted or
 * updated row.
 */
export async function upsertScan(sql, orgId, input) {
  if (!input?.skillName) throw new Error('upsertScan: skillName is required');
  if (!input?.targetHash) throw new Error('upsertScan: targetHash is required');

  const id = scanId();
  const findings = Array.isArray(input.findings) ? input.findings : [];
  const passed = Boolean(input.passed);

  const rows = await sql`
    INSERT INTO skill_scan_results (id, org_id, skill_name, target_hash, findings, passed)
    VALUES (${id}, ${orgId}, ${input.skillName}, ${input.targetHash}, ${findings}, ${passed})
    ON CONFLICT (org_id, skill_name, target_hash)
    DO UPDATE SET findings = EXCLUDED.findings, passed = EXCLUDED.passed
    RETURNING id, org_id, skill_name, target_hash, findings, passed, created_at
  `;
  return rows[0];
}

/**
 * Fetch a scan row by its primary key, scoped to the org. Returns null if
 * the row doesn't exist or belongs to a different org.
 */
export async function getScanById(sql, orgId, id) {
  const rows = await sql`
    SELECT id, org_id, skill_name, target_hash, findings, passed, created_at
    FROM skill_scan_results
    WHERE org_id = ${orgId} AND id = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}
