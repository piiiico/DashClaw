import { randomUUID } from 'node:crypto';

let _tableChecked = false;

async function ensureTables(sql) {
  if (_tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      workspace TEXT,
      branch TEXT,
      status TEXT NOT NULL DEFAULT 'spawning',
      status_since TIMESTAMPTZ DEFAULT NOW(),
      blocked_reason TEXT,
      green_level TEXT,
      branch_freshness TEXT,
      commits_behind INTEGER,
      last_activity TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_sessions_org ON agent_sessions (org_id, updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_sessions_org_agent ON agent_sessions (org_id, agent_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS session_events (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      detail TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events (session_id, seq)`;
  _tableChecked = true;
}

/**
 * Create a new agent session with status 'spawning' and an initial event.
 */
export async function createSession(sql, orgId, agentId, workspace, branch = null) {
  await ensureTables(sql);

  const hex = randomUUID().replace(/-/g, '').slice(0, 12);
  const id = `sess_${hex}`;

  const rows = await sql`
    INSERT INTO agent_sessions (id, org_id, agent_id, workspace, branch, status)
    VALUES (${id}, ${orgId}, ${agentId}, ${workspace}, ${branch}, 'spawning')
    RETURNING *
  `;

  await sql`
    INSERT INTO session_events (session_id, org_id, seq, kind)
    VALUES (${id}, ${orgId}, 1, 'spawning')
  `;

  return rows[0];
}

/**
 * Get a single session by id, scoped to org.
 */
export async function getSession(sql, sessionId, orgId) {
  await ensureTables(sql);

  const rows = await sql`
    SELECT * FROM agent_sessions
    WHERE id = ${sessionId} AND org_id = ${orgId}
    LIMIT 1
  `;

  return rows[0] || null;
}

/**
 * Update a session's mutable fields.
 * If status changes, inserts a new session_event with the next sequence number.
 */
export async function updateSession(sql, sessionId, orgId, updates) {
  await ensureTables(sql);

  const {
    status = null,
    green_level = null,
    branch_freshness = null,
    commits_behind = null,
    blocked_reason = null,
  } = updates;

  // blocked_reason only applies when status is 'blocked'
  const effectiveBlockedReason = status === 'blocked' ? blocked_reason : null;

  const rows = await sql`
    UPDATE agent_sessions SET
      status           = COALESCE(${status}, status),
      status_since     = CASE WHEN ${status} IS NOT NULL AND ${status} != status THEN NOW() ELSE status_since END,
      green_level      = COALESCE(${green_level}, green_level),
      branch_freshness = COALESCE(${branch_freshness}, branch_freshness),
      commits_behind   = COALESCE(${commits_behind}::integer, commits_behind),
      blocked_reason   = CASE WHEN ${status} = 'blocked' THEN ${effectiveBlockedReason} ELSE blocked_reason END,
      last_activity    = NOW(),
      updated_at       = NOW()
    WHERE id = ${sessionId} AND org_id = ${orgId}
    RETURNING *
  `;

  const session = rows[0] || null;

  // Insert a session event if the status actually changed
  if (session && status) {
    const seqRows = await sql`
      SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
      FROM session_events
      WHERE session_id = ${sessionId}
    `;
    const nextSeq = seqRows[0].next_seq;

    await sql`
      INSERT INTO session_events (session_id, org_id, seq, kind, detail)
      VALUES (${sessionId}, ${orgId}, ${nextSeq}, ${status}, ${effectiveBlockedReason})
    `;
  }

  return session;
}

/**
 * List sessions for an org with optional filters.
 */
export async function listSessions(sql, orgId, filters = {}) {
  await ensureTables(sql);

  const agentId = filters.agent_id || null;
  const status = filters.status || null;
  const limit = Math.min(parseInt(filters.limit, 10) || 50, 200);

  const rows = await sql`
    SELECT * FROM agent_sessions
    WHERE org_id = ${orgId}
      AND (${agentId}::text IS NULL OR agent_id = ${agentId})
      AND (${status}::text IS NULL OR status = ${status})
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;

  return rows;
}

/**
 * Get all events for a session, ordered by sequence.
 */
export async function getSessionEvents(sql, sessionId, orgId) {
  await ensureTables(sql);

  const rows = await sql`
    SELECT * FROM session_events
    WHERE session_id = ${sessionId} AND org_id = ${orgId}
    ORDER BY seq ASC
  `;

  return rows;
}
