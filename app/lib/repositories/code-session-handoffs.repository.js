/**
 * Repository for code_session_handoffs — durable agent-to-agent session
 * handoff bundles. An agent finishing a session can persist freeform JSON
 * (summary, open_loops, decisions_made, state_snapshot) that the next
 * session for the same (org, agent[, project]) can pick up and consume.
 *
 * Follows the existing repository pattern: every function takes
 * `(sql, orgId, ...)`, SQL is written as tagged templates, no raw
 * concatenation. `bundle` is JSONB — the Neon driver serializes the
 * JS object directly inside the template.
 */
import { randomBytes } from 'node:crypto';

function handoffId() {
  return 'hf_' + randomBytes(8).toString('hex');
}

/**
 * Insert a new handoff row. Bundle is freeform JSON the agent wants the next
 * session to see (summary, open_loops, decisions_made, state_snapshot).
 */
export async function createHandoff(sql, orgId, input) {
  if (!input?.agentId) throw new Error('createHandoff: agentId is required');
  if (!input?.bundle || typeof input.bundle !== 'object') {
    throw new Error('createHandoff: bundle (object) is required');
  }

  const id = handoffId();
  await sql`
    INSERT INTO code_session_handoffs (
      id, org_id, agent_id, project_id, created_in_session_id, bundle_json
    ) VALUES (
      ${id}, ${orgId}, ${input.agentId}, ${input.projectId || null},
      ${input.createdInSessionId || null}, ${input.bundle}
    )
  `;
  return { id };
}

/**
 * Return the latest unconsumed handoff for (orgId, agentId, projectId).
 * If projectId is null, returns the latest agent-wide handoff (project_id IS NULL).
 * Returns null if none.
 */
export async function getLatestHandoff(sql, orgId, filter) {
  const agentId = filter?.agentId;
  if (!agentId) throw new Error('getLatestHandoff: agentId is required');
  const projectId = filter?.projectId || null;

  const rows = projectId
    ? await sql`
        SELECT id, org_id, agent_id, project_id, created_in_session_id,
               bundle_json, created_at, consumed_at, consumed_by_session_id
        FROM code_session_handoffs
        WHERE org_id = ${orgId}
          AND agent_id = ${agentId}
          AND project_id = ${projectId}
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `
    : await sql`
        SELECT id, org_id, agent_id, project_id, created_in_session_id,
               bundle_json, created_at, consumed_at, consumed_by_session_id
        FROM code_session_handoffs
        WHERE org_id = ${orgId}
          AND agent_id = ${agentId}
          AND project_id IS NULL
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `;
  return rows[0] || null;
}

/**
 * List recent handoffs for an org, optionally filtered by agent and/or project.
 * Backs `GET /api/handoffs` (the dashboard Handoffs tab and the SDK
 * `get_handoffs` list method). Most-recent first.
 */
export async function listHandoffs(sql, orgId, filter = {}) {
  const agentId = filter.agentId || null;
  const projectId = filter.projectId || null;
  const limit = Math.min(parseInt(filter.limit, 10) || 20, 100);

  const rows = await sql`
    SELECT id, org_id, agent_id, project_id, created_in_session_id,
           bundle_json, created_at, consumed_at, consumed_by_session_id
    FROM code_session_handoffs
    WHERE org_id = ${orgId}
      ${agentId ? sql`AND agent_id = ${agentId}` : sql``}
      ${projectId ? sql`AND project_id = ${projectId}` : sql``}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows;
}

export async function getHandoffById(sql, orgId, id) {
  const rows = await sql`
    SELECT id, org_id, agent_id, project_id, created_in_session_id,
           bundle_json, created_at, consumed_at, consumed_by_session_id
    FROM code_session_handoffs
    WHERE org_id = ${orgId} AND id = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Set consumed_at + consumed_by_session_id IF currently null. Idempotent —
 * returns the row in both already-consumed and just-consumed cases.
 */
export async function consumeHandoff(sql, orgId, id, sessionId) {
  const rows = await sql`
    UPDATE code_session_handoffs
       SET consumed_at = NOW(),
           consumed_by_session_id = ${sessionId || null}
     WHERE org_id = ${orgId}
       AND id = ${id}
       AND consumed_at IS NULL
     RETURNING id, consumed_at, consumed_by_session_id
  `;
  if (rows[0]) return rows[0];

  const existing = await sql`
    SELECT id, consumed_at, consumed_by_session_id
    FROM code_session_handoffs
    WHERE org_id = ${orgId} AND id = ${id}
    LIMIT 1
  `;
  return existing[0] || null;
}
