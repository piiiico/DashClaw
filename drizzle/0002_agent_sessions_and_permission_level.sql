-- Add permission_level to agent_pairings
ALTER TABLE agent_pairings ADD COLUMN IF NOT EXISTS permission_level TEXT DEFAULT 'danger';

--> statement-breakpoint

-- Create agent_sessions table
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
);

--> statement-breakpoint

-- Create session_events table
CREATE TABLE IF NOT EXISTS session_events (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

--> statement-breakpoint

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_agent_sessions_org_status ON agent_sessions(org_id, status);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_agent_sessions_org_agent ON agent_sessions(org_id, agent_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_agent_sessions_last_activity ON agent_sessions(org_id, last_activity);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id, seq);
