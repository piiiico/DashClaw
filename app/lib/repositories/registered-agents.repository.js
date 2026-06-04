/**
 * Registered-agents repository (SPEC-mega.md Group C). All SQL for the agent
 * registry: registered providers, their grouped capabilities, and the thin
 * invocation records that reference the existing action + capability. Every
 * query is org-scoped; there is no cross-org access.
 */

import crypto from 'node:crypto';

function genId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 64) || 'agent';
}

export async function createRegisteredAgent(sql, orgId, data = {}) {
  const entryId = genId('reg');
  const slug = data.slug ? slugify(data.slug) : slugify(data.name);
  const rows = await sql`
    INSERT INTO registered_agents
      (entry_id, org_id, name, slug, endpoint, auth_type, auth_metadata, risk_class, default_budget_usd, status, metadata)
    VALUES
      (${entryId}, ${orgId}, ${data.name || slug}, ${slug}, ${data.endpoint || null}, ${data.auth_type || 'none'},
       ${JSON.stringify(data.auth_metadata || {})}::jsonb, ${data.risk_class || 'medium'}, ${data.default_budget_usd ?? null},
       ${data.status || 'active'}, ${JSON.stringify(data.metadata || {})}::jsonb)
    RETURNING *`;
  return rows[0] || null;
}

export async function listRegisteredAgents(sql, orgId, { status } = {}) {
  if (status) {
    return sql`SELECT * FROM registered_agents WHERE org_id = ${orgId} AND status = ${status} ORDER BY created_at DESC`;
  }
  return sql`SELECT * FROM registered_agents WHERE org_id = ${orgId} ORDER BY created_at DESC`;
}

export async function getRegisteredAgent(sql, orgId, entryId) {
  const rows = await sql`SELECT * FROM registered_agents WHERE org_id = ${orgId} AND entry_id = ${entryId} LIMIT 1`;
  return rows[0] || null;
}

const PATCHABLE = ['name', 'endpoint', 'auth_type', 'risk_class', 'default_budget_usd', 'status'];

export async function updateRegisteredAgent(sql, orgId, entryId, patch = {}) {
  const existing = await getRegisteredAgent(sql, orgId, entryId);
  if (!existing) return null;
  const next = { ...existing };
  for (const k of PATCHABLE) {
    if (patch[k] !== undefined) next[k] = patch[k];
  }
  const authMetadata = patch.auth_metadata !== undefined ? patch.auth_metadata : parseJson(existing.auth_metadata);
  const metadata = patch.metadata !== undefined ? patch.metadata : parseJson(existing.metadata);
  const rows = await sql`
    UPDATE registered_agents SET
      name = ${next.name}, endpoint = ${next.endpoint}, auth_type = ${next.auth_type},
      auth_metadata = ${JSON.stringify(authMetadata || {})}::jsonb, risk_class = ${next.risk_class},
      default_budget_usd = ${next.default_budget_usd ?? null}, status = ${next.status},
      metadata = ${JSON.stringify(metadata || {})}::jsonb, updated_at = NOW()
    WHERE org_id = ${orgId} AND entry_id = ${entryId}
    RETURNING *`;
  return rows[0] || null;
}

function parseJson(v) {
  if (v == null) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}

export async function addAgentCapability(sql, orgId, registeredAgentId, capabilityId) {
  const id = genId('rac');
  const rows = await sql`
    INSERT INTO registered_agent_capabilities (id, org_id, registered_agent_id, capability_id)
    VALUES (${id}, ${orgId}, ${registeredAgentId}, ${capabilityId})
    ON CONFLICT (org_id, registered_agent_id, capability_id) DO NOTHING
    RETURNING *`;
  return rows[0] || null;
}

export async function listAgentCapabilities(sql, orgId, registeredAgentId) {
  return sql`
    SELECT c.capability_id, c.name, c.slug, c.category, c.risk_level, c.source_type, c.health_status
    FROM registered_agent_capabilities rac
    JOIN capabilities c ON c.capability_id = rac.capability_id AND c.org_id = rac.org_id
    WHERE rac.org_id = ${orgId} AND rac.registered_agent_id = ${registeredAgentId}
    ORDER BY c.name`;
}

export async function isCapabilityGrouped(sql, orgId, registeredAgentId, capabilityId) {
  const rows = await sql`
    SELECT 1 FROM registered_agent_capabilities
    WHERE org_id = ${orgId} AND registered_agent_id = ${registeredAgentId} AND capability_id = ${capabilityId}
    LIMIT 1`;
  return rows.length > 0;
}

export async function recordInvocation(sql, orgId, { registeredAgentId, capabilityId = null, actionId = null, callerAgentId = null }) {
  const id = genId('rai');
  const rows = await sql`
    INSERT INTO agent_invocations (id, org_id, registered_agent_id, capability_id, action_id, caller_agent_id)
    VALUES (${id}, ${orgId}, ${registeredAgentId}, ${capabilityId}, ${actionId}, ${callerAgentId})
    RETURNING *`;
  return rows[0] || null;
}

export async function listInvocations(sql, orgId, registeredAgentId, { limit = 50 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return sql`
    SELECT * FROM agent_invocations
    WHERE org_id = ${orgId} AND registered_agent_id = ${registeredAgentId}
    ORDER BY created_at DESC LIMIT ${lim}`;
}
