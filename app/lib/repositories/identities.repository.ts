import type { SqlTag } from '../types/db';

let _tableChecked = false;

async function ensureTable(sql: SqlTag): Promise<void> {
  if (_tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_identities (
      org_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      algorithm TEXT NOT NULL DEFAULT 'RSASSA-PKCS1-v1_5',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (org_id, agent_id)
    )
  `;
  _tableChecked = true;
}

interface UpsertIdentityInput {
  orgId: string;
  agentId: string;
  publicKey: string;
  algorithm?: string;
}

export async function upsertIdentity(
  sql: SqlTag,
  { orgId, agentId, publicKey, algorithm }: UpsertIdentityInput
): Promise<Record<string, unknown>[]> {
  await ensureTable(sql);
  return sql`
    INSERT INTO agent_identities (org_id, agent_id, public_key, algorithm)
    VALUES (${orgId}, ${agentId}, ${publicKey}, ${algorithm || 'RSASSA-PKCS1-v1_5'})
    ON CONFLICT (org_id, agent_id) DO UPDATE
    SET public_key = EXCLUDED.public_key,
        algorithm = EXCLUDED.algorithm,
        updated_at = CURRENT_TIMESTAMP
    RETURNING agent_id, algorithm, created_at, updated_at
  `;
}

export async function listIdentities(
  sql: SqlTag,
  orgId: string
): Promise<Record<string, unknown>[]> {
  await ensureTable(sql);
  return sql`
    SELECT agent_id, algorithm, created_at, updated_at
    FROM agent_identities
    WHERE org_id = ${orgId}
    ORDER BY agent_id ASC
  `;
}

export async function deleteIdentity(
  sql: SqlTag,
  orgId: string,
  agentId: string
): Promise<Record<string, unknown>[]> {
  await ensureTable(sql);
  return sql`
    DELETE FROM agent_identities
    WHERE org_id = ${orgId} AND agent_id = ${agentId}
    RETURNING agent_id
  `;
}

export async function getIdentity(
  sql: SqlTag,
  orgId: string,
  agentId: string
): Promise<Record<string, unknown>[]> {
  await ensureTable(sql);
  return sql`
    SELECT public_key, algorithm
    FROM agent_identities
    WHERE org_id = ${orgId} AND agent_id = ${agentId}
    LIMIT 1
  `;
}
