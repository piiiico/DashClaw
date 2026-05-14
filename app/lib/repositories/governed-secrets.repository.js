/**
 * Repository for governed_secrets — agent/org-scoped secret rotation metadata.
 * Stores only rotation tracking (name, last_rotated_at, rotation_interval_days,
 * notes); the secret values themselves live in the agent's own secret manager.
 *
 * Follows the existing repository pattern: every function takes
 * `(sql, orgId, ...)`, SQL is written as tagged templates, no raw
 * concatenation. UNIQUE NULLS NOT DISTINCT on (org_id, agent_id, name)
 * means org-wide secrets (agent_id IS NULL) can't duplicate names within
 * an org.
 */
import { randomBytes } from 'node:crypto';

function secretId() {
  return 'sec_' + randomBytes(8).toString('hex');
}

/**
 * List secrets for an org. If filter.agentId is provided, returns secrets
 * scoped to that agent. Otherwise returns org-wide secrets (agent_id IS NULL).
 * Each row includes a computed `next_rotation_due` derived from
 * `last_rotated_at + rotation_interval_days`.
 */
export async function listSecrets(sql, orgId, filter = {}) {
  if (filter.agentId) {
    return sql`
      SELECT id, org_id, agent_id, name, last_rotated_at, rotation_interval_days,
             notes, created_at, updated_at,
             (last_rotated_at + (rotation_interval_days * INTERVAL '1 day')) AS next_rotation_due
      FROM governed_secrets
      WHERE org_id = ${orgId} AND agent_id = ${filter.agentId}
      ORDER BY name ASC
    `;
  }
  return sql`
    SELECT id, org_id, agent_id, name, last_rotated_at, rotation_interval_days,
           notes, created_at, updated_at,
           (last_rotated_at + (rotation_interval_days * INTERVAL '1 day')) AS next_rotation_due
    FROM governed_secrets
    WHERE org_id = ${orgId} AND agent_id IS NULL
    ORDER BY name ASC
  `;
}

/**
 * Insert a new secret rotation record. `name` is required. `lastRotatedAt`
 * defaults to NOW() via the column default when not provided; the Neon HTTP
 * driver does not accept tagged-template fragments inline, so we branch
 * into two INSERT queries.
 */
export async function createSecret(sql, orgId, input) {
  if (!input?.name) throw new Error('createSecret: name is required');
  const id = secretId();
  const rotationIntervalDays = Number(input.rotationIntervalDays) || 90;
  const lastRotatedAt = input.lastRotatedAt || null;

  const rows = lastRotatedAt
    ? await sql`
        INSERT INTO governed_secrets (
          id, org_id, agent_id, name, last_rotated_at, rotation_interval_days, notes
        ) VALUES (
          ${id}, ${orgId}, ${input.agentId || null}, ${input.name},
          ${lastRotatedAt}, ${rotationIntervalDays}, ${input.notes || null}
        )
        RETURNING id, name, last_rotated_at, rotation_interval_days
      `
    : await sql`
        INSERT INTO governed_secrets (
          id, org_id, agent_id, name, rotation_interval_days, notes
        ) VALUES (
          ${id}, ${orgId}, ${input.agentId || null}, ${input.name},
          ${rotationIntervalDays}, ${input.notes || null}
        )
        RETURNING id, name, last_rotated_at, rotation_interval_days
      `;
  return rows[0] || { id };
}

/**
 * Patch lastRotatedAt, rotationIntervalDays, or notes. Each field is
 * applied via COALESCE so unspecified fields keep their current values.
 */
export async function updateSecret(sql, orgId, id, patch) {
  const rotationIntervalDays = patch.rotationIntervalDays != null
    ? Number(patch.rotationIntervalDays)
    : null;

  const rows = await sql`
    UPDATE governed_secrets
       SET last_rotated_at = COALESCE(${patch.lastRotatedAt || null}, last_rotated_at),
           rotation_interval_days = COALESCE(${rotationIntervalDays}, rotation_interval_days),
           notes = COALESCE(${patch.notes !== undefined ? patch.notes : null}, notes),
           updated_at = NOW()
     WHERE org_id = ${orgId} AND id = ${id}
     RETURNING id, last_rotated_at, rotation_interval_days, notes, updated_at
  `;
  return rows[0] || null;
}

export async function deleteSecret(sql, orgId, id) {
  const rows = await sql`
    DELETE FROM governed_secrets
    WHERE org_id = ${orgId} AND id = ${id}
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Return secrets whose next rotation date falls within `withinDays` of now
 * (default 14). Each row includes `days_until_due` as an integer (can be
 * negative for already-overdue secrets). Scoped by agent if provided.
 */
export async function listRotationDue(sql, orgId, filter = {}) {
  const withinDays = Number(filter.withinDays) || 14;
  if (filter.agentId) {
    return sql`
      SELECT id, name, agent_id, last_rotated_at, rotation_interval_days,
             EXTRACT(DAY FROM (last_rotated_at + (rotation_interval_days * INTERVAL '1 day') - NOW()))::int AS days_until_due
      FROM governed_secrets
      WHERE org_id = ${orgId}
        AND agent_id = ${filter.agentId}
        AND (last_rotated_at + (rotation_interval_days * INTERVAL '1 day')) <= NOW() + (${withinDays} * INTERVAL '1 day')
      ORDER BY last_rotated_at + (rotation_interval_days * INTERVAL '1 day') ASC
    `;
  }
  return sql`
    SELECT id, name, agent_id, last_rotated_at, rotation_interval_days,
           EXTRACT(DAY FROM (last_rotated_at + (rotation_interval_days * INTERVAL '1 day') - NOW()))::int AS days_until_due
    FROM governed_secrets
    WHERE org_id = ${orgId}
      AND (last_rotated_at + (rotation_interval_days * INTERVAL '1 day')) <= NOW() + (${withinDays} * INTERVAL '1 day')
    ORDER BY last_rotated_at + (rotation_interval_days * INTERVAL '1 day') ASC
  `;
}
