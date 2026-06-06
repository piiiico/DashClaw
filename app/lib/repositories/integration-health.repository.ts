import type { SqlTag } from '../types/db';

let _tableChecked = false;

async function ensureTable(sql: SqlTag): Promise<void> {
  if (_tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS integration_health (
      id SERIAL PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT 'org_default',
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      message TEXT DEFAULT '',
      checked_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, provider)
    )
  `;
  _tableChecked = true;
}

/**
 * Insert-or-update the health row and return what changed.
 *
 * `prev_status` is null when the provider has never been checked for this
 * org (first observation). Callers use `changed` + `prev_status` to decide
 * whether a state-change signal should fire — first observations do NOT
 * count as a transition and should not alert.
 */
export async function upsertHealth(
  sql: SqlTag,
  orgId: string,
  provider: string,
  status: string,
  message: string,
): Promise<{ changed: boolean; prev_status: string | null; new_status: string }> {
  await ensureTable(sql);
  const prior = await sql`
    SELECT status FROM integration_health
    WHERE org_id = ${orgId} AND provider = ${provider}
    LIMIT 1
  `;
  const prev_status = prior.length > 0 ? (prior[0]?.status as string | null) : null;

  await sql`
    INSERT INTO integration_health (org_id, provider, status, message, checked_at)
    VALUES (${orgId}, ${provider}, ${status}, ${message}, NOW())
    ON CONFLICT (org_id, provider) DO UPDATE
    SET status = EXCLUDED.status, message = EXCLUDED.message, checked_at = NOW()
  `;

  return {
    changed: prev_status !== null && prev_status !== status,
    prev_status,
    new_status: status,
  };
}

export async function getActiveOrgIds(sql: SqlTag): Promise<Record<string, unknown>[]> {
  return sql`SELECT DISTINCT org_id AS id FROM settings WHERE org_id != 'org_default'`;
}

export async function getHealthForOrg(sql: SqlTag, orgId: string): Promise<Record<string, unknown>[]> {
  await ensureTable(sql);
  return sql`
    SELECT provider, status, message, checked_at
    FROM integration_health
    WHERE org_id = ${orgId}
    ORDER BY provider
  `;
}
