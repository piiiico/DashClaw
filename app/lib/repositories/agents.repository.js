function isMissingTable(err) {
  return String(err?.code || '').includes('42P01') || String(err?.message || '').includes('does not exist');
}

/**
 * Returns true when the agent_id has any trace of belonging to the org:
 * a presence record, an identity record, a pairing, or a recorded action.
 * Used as a tenant-ownership gate on user-supplied agent_id fields —
 * messages/feedback/etc — to prevent cross-org spoofing.
 */
export async function agentExistsInOrg(sql, orgId, agentId) {
  if (!agentId || typeof agentId !== 'string') return false;
  try {
    const rows = await sql`
      SELECT 1 FROM agent_presence WHERE org_id = ${orgId} AND agent_id = ${agentId} LIMIT 1
    `;
    if (rows.length > 0) return true;
  } catch (err) { if (!isMissingTable(err)) throw err; }
  try {
    const rows = await sql`
      SELECT 1 FROM agent_identities WHERE org_id = ${orgId} AND agent_id = ${agentId} LIMIT 1
    `;
    if (rows.length > 0) return true;
  } catch (err) { if (!isMissingTable(err)) throw err; }
  try {
    const rows = await sql`
      SELECT 1 FROM agent_pairings WHERE org_id = ${orgId} AND agent_id = ${agentId} LIMIT 1
    `;
    if (rows.length > 0) return true;
  } catch (err) { if (!isMissingTable(err)) throw err; }
  try {
    const rows = await sql`
      SELECT 1 FROM action_records WHERE org_id = ${orgId} AND agent_id = ${agentId} LIMIT 1
    `;
    if (rows.length > 0) return true;
  } catch (err) { if (!isMissingTable(err)) throw err; }
  return false;
}

function maxIso(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return String(a) > String(b) ? a : b;
}

/**
 * Build an agent list for an org without requiring action_records to exist.
 * Intended to support bootstrap/import flows where goals/decisions exist before actions.
 */
export async function listAgentsForOrg(sql, orgId) {
  const byId = new Map();

  // Primary signal: action_records (most complete metadata).
  try {
    const rows = await sql.query(
      `
        SELECT agent_id, MAX(agent_name) as agent_name, COUNT(*) as action_count,
          MAX(timestamp_start) as last_active
        FROM action_records
        WHERE org_id = $1
        GROUP BY agent_id
      `,
      [orgId]
    );
    for (const r of rows || []) {
      if (!r.agent_id) continue;
      byId.set(r.agent_id, {
        agent_id: r.agent_id,
        agent_name: r.agent_name || r.agent_id,
        action_count: Number(r.action_count || 0),
        last_active: r.last_active || null,
        last_goal: null,
        last_decision: null,
      });
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }

  const mergeAgent = (agentId, fields = {}) => {
    if (!agentId) return;
    const existing = byId.get(agentId) || {
      agent_id: agentId,
      agent_name: agentId,
      action_count: 0,
      last_active: null,
      last_goal: null,
      last_decision: null,
    };
    byId.set(agentId, { ...existing, ...fields });
  };

  // Fallback: goals imported without actions.
  try {
    const rows = await sql.query(
      `
        SELECT agent_id, COUNT(*) as goal_count, MAX(created_at) as last_goal
        FROM goals
        WHERE org_id = $1 AND agent_id IS NOT NULL
        GROUP BY agent_id
      `,
      [orgId]
    );
    for (const r of rows || []) {
      mergeAgent(r.agent_id, { goal_count: Number(r.goal_count || 0), last_goal: r.last_goal || null });
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }

  // Fallback: decisions imported without actions.
  try {
    const rows = await sql.query(
      `
        SELECT agent_id, COUNT(*) as decision_count, MAX(timestamp) as last_decision
        FROM decisions
        WHERE org_id = $1 AND agent_id IS NOT NULL
        GROUP BY agent_id
      `,
      [orgId]
    );
    for (const r of rows || []) {
      mergeAgent(r.agent_id, { decision_count: Number(r.decision_count || 0), last_decision: r.last_decision || null });
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }

  // Fallback: token_snapshots without actions.
  try {
    const rows = await sql.query(
      `
        SELECT agent_id, COUNT(*) as snapshot_count, MAX(timestamp) as last_snapshot
        FROM token_snapshots
        WHERE org_id = $1 AND agent_id IS NOT NULL
        GROUP BY agent_id
      `,
      [orgId]
    );
    for (const r of rows || []) {
      mergeAgent(r.agent_id, { snapshot_count: Number(r.snapshot_count || 0), last_snapshot: r.last_snapshot || null });
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }

  const agents = [...byId.values()].map((a) => {
    const last_active = maxIso(a.last_active, maxIso(a.last_goal, maxIso(a.last_decision, a.last_snapshot)));
    return {
      agent_id: a.agent_id,
      agent_name: a.agent_name || a.agent_id,
      action_count: Number(a.action_count || 0),
      last_active,
      goal_count: Number(a.goal_count || 0),
      decision_count: Number(a.decision_count || 0),
    };
  });

  // Attach presence data (heartbeats)
  try {
    const presence = await sql.query(
      `SELECT * FROM agent_presence WHERE org_id = $1`,
      [orgId]
    );
    const presenceMap = {};
    for (const p of presence || []) {
      presenceMap[p.agent_id] = p;
    }

    const now = Date.now();
    const ONLINE_WINDOW_MS = (parseInt(process.env.AGENT_ONLINE_WINDOW_MS) || 10 * 60 * 1000); // Default 10m
    const STALE_WINDOW_MS = ONLINE_WINDOW_MS * 3; // 30m considered stale before offline

    // Helper: compute status from timestamps
    const calculatePresence = (lastHeartbeat, lastActive, reportedStatus) => {
      if (reportedStatus === 'offline' || reportedStatus === 'error') {
        const lastSeenStr = maxIso(lastHeartbeat, lastActive);
        const seconds = lastSeenStr ? Math.floor((now - new Date(lastSeenStr).getTime()) / 1000) : null;
        return { state: 'offline', seconds, last_seen: lastSeenStr };
      }

      // Prefer heartbeat, then last_active
      const lastSeenStr = maxIso(lastHeartbeat, lastActive);
      if (!lastSeenStr) return { state: 'unknown', seconds: null, last_seen: null };
      
      const lastSeenMs = new Date(lastSeenStr).getTime();
      const diff = now - lastSeenMs;
      const seconds = Math.floor(diff / 1000);

      let state = 'offline';
      if (diff < ONLINE_WINDOW_MS) state = 'online';
      else if (diff < STALE_WINDOW_MS) state = 'stale';

      return { state, seconds, last_seen: lastSeenStr };
    };

    // First pass: attach presence to agents already in the list
    for (const agent of agents) {
      const p = presenceMap[agent.agent_id];
      let lastHeartbeat = null;
      let reportedStatus = 'unknown';

      if (p) {
        agent.reported_status = p.status;
        agent.last_heartbeat_at = p.last_heartbeat_at;
        agent.current_task_id = p.current_task_id;
        try {
          agent.presence_metadata = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata;
        } catch { agent.presence_metadata = {}; }
        lastHeartbeat = p.last_heartbeat_at;
        reportedStatus = p.status;
      } else {
        agent.reported_status = 'unknown';
      }

      // Calculate derived presence state
      const { state, seconds, last_seen } = calculatePresence(lastHeartbeat, agent.last_active, reportedStatus);
      agent.presence_state = state;
      agent.seconds_since_seen = seconds;
      agent.last_seen_at = last_seen;
      
      // Legacy compat
      agent.status = (reportedStatus === 'offline' ? 'offline' : state);
    }

    // Second pass: add agents that only exist in agent_presence (heartbeat-only, no actions yet)
    for (const p of presence || []) {
      if (!byId.has(p.agent_id)) {
        let presence_metadata = {};
        try {
          presence_metadata = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata;
        } catch { presence_metadata = {}; }

        const { state, seconds, last_seen } = calculatePresence(p.last_heartbeat_at, null, p.status);

        agents.push({
          agent_id: p.agent_id,
          agent_name: p.agent_name || p.agent_id,
          action_count: 0,
          last_active: p.last_heartbeat_at,
          reported_status: p.status,
          status: (p.status === 'offline' ? 'offline' : state), // legacy compat
          presence_state: state,
          seconds_since_seen: seconds,
          last_seen_at: last_seen,
          last_heartbeat_at: p.last_heartbeat_at,
          current_task_id: p.current_task_id,
          presence_metadata,
        });
      }
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }

  agents.sort((a, b) => {
    // Sort online agents to top
    if (a.presence_state === 'online' && b.presence_state !== 'online') return -1;
    if (b.presence_state === 'online' && a.presence_state !== 'online') return 1;
    
    // Then by recency
    const aTime = a.last_seen_at || '';
    const bTime = b.last_seen_at || '';
    return String(bTime).localeCompare(String(aTime));
  });
  return agents;
}

/**
 * Retrieve a single agent's detailed profile.
 */
export async function getAgentDetail(sql, orgId, agentId) {
  const agents = await listAgentsForOrg(sql, orgId);
  const agent = agents.find(a => a.agent_id === agentId);
  if (!agent) return null;

  await attachAgentConnections(sql, orgId, [agent]);
  return agent;
}

/**
 * Update or create an agent's presence record (heartbeat).
 */
export async function upsertAgentPresence(sql, orgId, payload) {
  const { agent_id, agent_name, status, current_task_id, metadata, timestamp } = payload;
  
  return sql`
    INSERT INTO agent_presence (
      org_id, agent_id, agent_name, status, current_task_id, 
      last_heartbeat_at, metadata, updated_at
    ) VALUES (
      ${orgId}, ${agent_id}, ${agent_name || null}, ${status}, ${current_task_id || null}, 
      ${timestamp}, ${JSON.stringify(metadata || {})}, ${timestamp}
    )
    ON CONFLICT (org_id, agent_id) DO UPDATE SET
      agent_name = EXCLUDED.agent_name,
      status = EXCLUDED.status,
      current_task_id = EXCLUDED.current_task_id,
      last_heartbeat_at = EXCLUDED.last_heartbeat_at,
      metadata = EXCLUDED.metadata,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `;
}

/**
 * Ensure the agent_presence table exists (lazy migration).
 */
export async function ensureAgentPresenceTable(sql) {
  return sql`
    CREATE TABLE IF NOT EXISTS agent_presence (
      org_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_name TEXT,
      status TEXT DEFAULT 'online',
      current_task_id TEXT,
      last_heartbeat_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (org_id, agent_id)
    )
  `;
}

export async function attachAgentConnections(sql, orgId, agents) {
  if (!Array.isArray(agents) || agents.length === 0) return agents || [];

  try {
    const connections = await sql.query(
      `
        SELECT *
        FROM agent_connections
        WHERE org_id = $1
        ORDER BY updated_at DESC
      `,
      [orgId]
    );
    const connMap = {};
    for (const conn of connections || []) {
      if (!connMap[conn.agent_id]) connMap[conn.agent_id] = [];
      connMap[conn.agent_id].push(conn);
    }
    for (const agent of agents) {
      agent.connections = connMap[agent.agent_id] || [];
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    for (const agent of agents) agent.connections = [];
  }

  return agents;
}

/**
 * Aggregate trust posture for a single agent.
 *
 * Runs the five independent lookups in parallel, and collapses the three
 * action_records COUNTs into a single scan with FILTER clauses — previously
 * this function fired 7 serial SQL round-trips on every agent profile view.
 */
export async function getAgentTrustPosture(sql, orgId, agentId) {
  // Wrap each query so a missing-table failure degrades to a safe default
  // without bringing down the whole aggregation.
  const safe = async (runner, fallback) => {
    try { return await runner(); }
    catch (err) {
      if (isMissingTable(err)) return fallback;
      throw err;
    }
  };

  const [pairingRows, identityRows, settingsRows, policyRows, actionCountsRows] = await Promise.all([
    safe(() => sql`SELECT permission_level, status FROM agent_pairings WHERE org_id = ${orgId} AND agent_id = ${agentId} AND status = 'approved' LIMIT 1`, []),
    safe(() => sql`SELECT agent_id FROM agent_identities WHERE org_id = ${orgId} AND agent_id = ${agentId} LIMIT 1`, []),
    safe(() => sql`SELECT value FROM settings WHERE org_id = ${orgId} AND key = 'ENFORCE_AGENT_SIGNATURES' LIMIT 1`, []),
    safe(() => sql`SELECT id, policy_type, description, agent_ids FROM policies WHERE org_id = ${orgId} AND active = true`, []),
    safe(() => sql`
      SELECT
        COUNT(*) FILTER (WHERE approved_by IS NOT NULL)::int AS approved_count,
        COUNT(*) FILTER (WHERE status = 'failed' AND error_message LIKE '%Denied by human%')::int AS denied_count,
        COUNT(*) FILTER (WHERE status = 'blocked' AND timestamp_start::timestamptz > NOW() - INTERVAL '30 days')::int AS blocks_count
      FROM action_records
      WHERE org_id = ${orgId} AND agent_id = ${agentId}
    `, [{ approved_count: 0, denied_count: 0, blocks_count: 0 }]),
  ]);

  const permissionLevel = pairingRows[0]?.permission_level || 'unknown';
  const identityVerified = identityRows.length > 0;
  const signatureEnforced = settingsRows[0]?.value === 'true';

  const policies = (policyRows || []).filter((p) => {
    if (!p.agent_ids) return true; // global
    try {
      const ids = JSON.parse(p.agent_ids);
      return Array.isArray(ids) && ids.includes(agentId);
    } catch { return false; }
  }).map((p) => ({
    policy_id: p.id,
    type: p.policy_type,
    description: p.description,
    scope: p.agent_ids ? 'agent' : 'global',
  }));

  const counts = actionCountsRows[0] || { approved_count: 0, denied_count: 0, blocks_count: 0 };
  const approvalAllowed = counts.approved_count || 0;
  const approvalDenied = counts.denied_count || 0;
  const blocks30d = counts.blocks_count || 0;

  return {
    permission_level: permissionLevel,
    identity_verified: identityVerified,
    signature_enforced: signatureEnforced,
    active_policies_count: policies.length,
    policies,
    approval_record: {
      total: approvalAllowed + approvalDenied,
      allowed: approvalAllowed,
      denied: approvalDenied,
    },
    blocks_30d: blocks30d,
  };
}
