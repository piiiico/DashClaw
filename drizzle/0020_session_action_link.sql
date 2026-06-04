-- Link action_records to agent_sessions so the /sessions page can be grounded
-- in real governed-action telemetry (action_count, cost, risk, last decision).
--
-- The legacy CI columns on agent_sessions (green_level, branch_freshness,
-- commits_behind, branch_freshness) were bound to a telemetry source that was
-- never built; no writer ever sets them. Rather than surface empty columns,
-- /sessions now aggregates the agent's action_records. This column lets a
-- writer stamp the originating session_id directly; until SDK/MCP stamping
-- ships, listSessions/getSession fall back to an agent_id + time-window match.
--
-- Additive + idempotent: ADD COLUMN IF NOT EXISTS is a no-op on databases that
-- already have the column, and the auto-migrator's SAFE_CODES covers the rest.
ALTER TABLE action_records ADD COLUMN IF NOT EXISTS session_id TEXT;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_action_records_org_session ON action_records (org_id, session_id);
