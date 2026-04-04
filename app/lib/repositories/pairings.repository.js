let _tableChecked = false;

async function ensureTable(sql) {
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

export async function createPairing(sql, { orgId, id, agentId, agentName, publicKey, algorithm, expiresAt }) {
  await ensureTable(sql);
  return sql`
    INSERT INTO agent_pairings (id, org_id, agent_id, agent_name, public_key, algorithm, status, expires_at)
    VALUES (${id}, ${orgId}, ${agentId}, ${agentName}, ${publicKey}, ${algorithm}, 'pending', ${expiresAt})
    RETURNING id, agent_id, agent_name, algorithm, status, created_at, expires_at
  `;
}

export async function listPairings(sql, orgId, status = 'pending', limit = 50) {
  await ensureTable(sql);
  return sql`
    SELECT id, agent_id, agent_name, algorithm, status, permission_level, created_at, updated_at, expires_at
    FROM agent_pairings
    WHERE org_id = ${orgId} AND status = ${status}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function getPairing(sql, orgId, pairingId) {
  await ensureTable(sql);
  return sql`
    SELECT id, agent_id, agent_name, public_key, algorithm, status, permission_level, created_at, updated_at, expires_at
    FROM agent_pairings
    WHERE org_id = ${orgId} AND id = ${pairingId}
    LIMIT 1
  `;
}

export async function expirePairing(sql, orgId, pairingId) {
  await ensureTable(sql);
  return sql`
    UPDATE agent_pairings
    SET status = 'expired', updated_at = CURRENT_TIMESTAMP
    WHERE org_id = ${orgId} AND id = ${pairingId}
  `;
}

export async function approvePairing(sql, orgId, pairingId) {
  await ensureTable(sql);
  return sql`
    UPDATE agent_pairings
    SET status = 'approved', updated_at = CURRENT_TIMESTAMP
    WHERE org_id = ${orgId} AND id = ${pairingId}
  `;
}

export async function expirePendingByAgent(sql, orgId, agentId) {
  await ensureTable(sql);
  return sql`
    UPDATE agent_pairings
    SET status = 'expired', updated_at = CURRENT_TIMESTAMP
    WHERE org_id = ${orgId} AND agent_id = ${agentId} AND status = 'pending'
  `;
}

export async function updatePairing(sql, orgId, pairingId, { status = null, permission_level = null }) {
  await ensureTable(sql);
  const rows = await sql`
    UPDATE agent_pairings SET
      status           = COALESCE(${status}, status),
      permission_level = COALESCE(${permission_level}, permission_level),
      updated_at       = CURRENT_TIMESTAMP
    WHERE org_id = ${orgId} AND id = ${pairingId}
    RETURNING id, agent_id, agent_name, algorithm, status, permission_level, created_at, updated_at, expires_at
  `;
  return rows[0] || null;
}
