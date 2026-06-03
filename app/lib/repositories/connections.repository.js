/**
 * Repository for agent connections
 * Handles all database operations for agent_connections table
 */

const VALID_AUTH_TYPES = ['api_key', 'subscription', 'oauth', 'pre_configured', 'environment'];
const VALID_STATUSES = ['active', 'inactive', 'error'];

/**
 * Ensure agent_connections table exists
 */
export async function ensureConnectionsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS agent_connections (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT 'org_default',
      agent_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      auth_type TEXT NOT NULL DEFAULT 'api_key',
      plan_name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      metadata TEXT,
      reported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS agent_connections_org_agent_provider_unique
    ON agent_connections (org_id, agent_id, provider)
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_connections_agent_id ON agent_connections(agent_id)`;
}

/**
 * List connections with optional filters
 */
export async function listConnections(sql, orgId, { agentId, provider } = {}) {
  // SECURITY: Use parameterized queries only — no sql.unsafe().
  let connections;
  if (agentId && provider) {
    connections = await sql`SELECT * FROM agent_connections WHERE org_id = ${orgId} AND agent_id = ${agentId} AND provider = ${provider} ORDER BY updated_at DESC`;
  } else if (agentId) {
    connections = await sql`SELECT * FROM agent_connections WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY updated_at DESC`;
  } else if (provider) {
    connections = await sql`SELECT * FROM agent_connections WHERE org_id = ${orgId} AND provider = ${provider} ORDER BY updated_at DESC`;
  } else {
    connections = await sql`SELECT * FROM agent_connections WHERE org_id = ${orgId} ORDER BY updated_at DESC`;
  }

  return connections || [];
}

/**
 * Upsert a single connection
 */
export async function upsertConnection(sql, orgId, agentId, connection) {
  const {
    provider,
    auth_type = 'api_key',
    status = 'active',
    plan_name = null,
    metadata = null
  } = connection;

  // Validation
  if (!provider || typeof provider !== 'string' || provider.length > 128) {
    throw new Error('provider is required and must be <= 128 chars');
  }
  if (auth_type && !VALID_AUTH_TYPES.includes(auth_type)) {
    throw new Error(`auth_type must be one of: ${VALID_AUTH_TYPES.join(', ')}`);
  }
  if (status && !VALID_STATUSES.includes(status)) {
    throw new Error(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }
  if (plan_name != null && (typeof plan_name !== 'string' || plan_name.length > 256)) {
    throw new Error('plan_name must be a string <= 256 chars');
  }

  const metadataStr = metadata
    ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata))
    : null;

  if (metadataStr && metadataStr.length > 10000) {
    throw new Error('metadata too large (max 10KB)');
  }

  const crypto = await import('node:crypto');
  const id = `conn_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const rows = await sql`
    INSERT INTO agent_connections (id, org_id, agent_id, provider, auth_type, plan_name, status, metadata, reported_at, updated_at)
    VALUES (${id}, ${orgId}, ${agentId}, ${provider}, ${auth_type}, ${plan_name}, ${status}, ${metadataStr}, ${now}, ${now})
    ON CONFLICT (org_id, agent_id, provider) DO UPDATE SET
      auth_type = EXCLUDED.auth_type,
      plan_name = EXCLUDED.plan_name,
      status = EXCLUDED.status,
      metadata = EXCLUDED.metadata,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `;

  return rows[0];
}

/**
 * Batch upsert connections
 */
export async function upsertConnections(sql, orgId, agentId, connections) {
  if (!agentId || typeof agentId !== 'string' || agentId.length > 128) {
    throw new Error('agent_id is required and must be <= 128 chars');
  }
  if (!Array.isArray(connections) || connections.length === 0) {
    throw new Error('connections array is required and must not be empty');
  }
  if (connections.length > 50) {
    throw new Error('Maximum 50 connections per request');
  }

  const results = [];
  const errors = [];

  for (const conn of connections) {
    try {
      const result = await upsertConnection(sql, orgId, agentId, conn);
      results.push(result);
    } catch (error) {
      errors.push({ provider: conn.provider, error: error.message });
    }
  }

  return { results, errors };
}
