import type { SqlTag } from '../types/db';

let _tableChecked = false;

async function ensureTable(sql: SqlTag): Promise<void> {
  if (_tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_pairings (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_name TEXT,
      public_key TEXT NOT NULL,
      algorithm TEXT NOT NULL DEFAULT 'RSASSA-PKCS1-v1_5',
      status TEXT NOT NULL DEFAULT 'pending',
      permission_level TEXT NOT NULL DEFAULT 'danger',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_pairings_org_status ON agent_pairings (org_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_pairings_org_agent ON agent_pairings (org_id, agent_id)`;
  _tableChecked = true;
}

interface CreatePairingInput {
  orgId: string;
  id: string;
  agentId: string;
  agentName?: string | null;
  publicKey: string;
  algorithm: string;
  expiresAt: string;
}

export async function createPairing(
  sql: SqlTag,
  { orgId, id, agentId, agentName, publicKey, algorithm, expiresAt }: CreatePairingInput
): Promise<Record<string, unknown>[]> {
  await ensureTable(sql);
  return sql`
    INSERT INTO agent_pairings (id, org_id, agent_id, agent_name, public_key, algorithm, status, expires_at)
    VALUES (${id}, ${orgId}, ${agentId}, ${agentName}, ${publicKey}, ${algorithm}, 'pending', ${expiresAt})
    RETURNING id, agent_id, agent_name, algorithm, status, created_at, expires_at
  `;
}

export async function listPairings(
  sql: SqlTag,
  orgId: string,
  status: string = 'pending',
  limit: number = 50
): Promise<Record<string, unknown>[]> {
  await ensureTable(sql);
  return sql`
    SELECT id, agent_id, agent_name, algorithm, status, permission_level, created_at, updated_at, expires_at
    FROM agent_pairings
    WHERE org_id = ${orgId} AND status = ${status}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function getPairing(
  sql: SqlTag,
  orgId: string,
  pairingId: string
): Promise<Record<string, unknown>[]> {
  await ensureTable(sql);
  return sql`
    SELECT id, agent_id, agent_name, public_key, algorithm, status, permission_level, created_at, updated_at, expires_at
    FROM agent_pairings
    WHERE org_id = ${orgId} AND id = ${pairingId}
    LIMIT 1
  `;
}

export async function expirePairing(
  sql: SqlTag,
  orgId: string,
  pairingId: string
): Promise<Record<string, unknown>[]> {
  await ensureTable(sql);
  return sql`
    UPDATE agent_pairings
    SET status = 'expired', updated_at = CURRENT_TIMESTAMP
    WHERE org_id = ${orgId} AND id = ${pairingId}
  `;
}

export async function approvePairing(
  sql: SqlTag,
  orgId: string,
  pairingId: string
): Promise<Record<string, unknown>[]> {
  await ensureTable(sql);
  return sql`
    UPDATE agent_pairings
    SET status = 'approved', updated_at = CURRENT_TIMESTAMP
    WHERE org_id = ${orgId} AND id = ${pairingId} AND status = 'pending'
  `;
}

export async function expirePendingByAgent(
  sql: SqlTag,
  orgId: string,
  agentId: string
): Promise<Record<string, unknown>[]> {
  await ensureTable(sql);
  return sql`
    UPDATE agent_pairings
    SET status = 'expired', updated_at = CURRENT_TIMESTAMP
    WHERE org_id = ${orgId} AND agent_id = ${agentId} AND status = 'pending'
  `;
}

interface UpdatePairingPatch {
  status?: string | null;
  permission_level?: string | null;
}

export async function updatePairing(
  sql: SqlTag,
  orgId: string,
  pairingId: string,
  { status = null, permission_level = null }: UpdatePairingPatch = {}
): Promise<Record<string, unknown> | null> {
  await ensureTable(sql);
  const rows = await sql`
    UPDATE agent_pairings SET
      status           = COALESCE(${status}, status),
      permission_level = COALESCE(${permission_level}, permission_level),
      updated_at       = CURRENT_TIMESTAMP
    WHERE org_id = ${orgId} AND id = ${pairingId}
    RETURNING id, agent_id, agent_name, algorithm, status, permission_level, created_at, updated_at, expires_at
  `;
  return rows[0] ?? null;
}
