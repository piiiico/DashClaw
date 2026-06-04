import { getSql } from './db.js';

let _ensured = false;

export async function ensureAgentPairingsTable(sql = null) {
  if (_ensured) return;
  const _sql = sql || getSql();

  await _sql`
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

  await _sql`CREATE INDEX IF NOT EXISTS idx_agent_pairings_org_status ON agent_pairings (org_id, status)`;
  await _sql`CREATE INDEX IF NOT EXISTS idx_agent_pairings_org_agent ON agent_pairings (org_id, agent_id)`;

  _ensured = true;
}

