-- 0007_agent_toolkit_into_runtime.sql
-- Promotes the agent-tools/ Python CLI bundle into first-class runtime
-- features: session handoffs, secret rotation tracker, skill safety
-- scanner. See docs/superpowers/specs/2026-05-14-agent-toolkit-into-runtime-design.md

CREATE TABLE IF NOT EXISTS code_session_handoffs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  project_id TEXT REFERENCES code_projects(id) ON DELETE SET NULL,
  created_in_session_id TEXT,
  bundle_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  consumed_by_session_id TEXT
);

CREATE INDEX IF NOT EXISTS code_session_handoffs_lookup_idx
  ON code_session_handoffs (org_id, agent_id, project_id, consumed_at, created_at DESC);

CREATE TABLE IF NOT EXISTS governed_secrets (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id TEXT,
  name TEXT NOT NULL,
  last_rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotation_interval_days INTEGER NOT NULL DEFAULT 90,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT governed_secrets_unique_per_agent UNIQUE (org_id, agent_id, name)
);

CREATE INDEX IF NOT EXISTS governed_secrets_org_agent_idx
  ON governed_secrets (org_id, agent_id);

CREATE TABLE IF NOT EXISTS skill_scan_results (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  target_hash TEXT NOT NULL,
  findings JSONB NOT NULL,
  passed BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT skill_scan_results_dedupe UNIQUE (org_id, skill_name, target_hash)
);

CREATE INDEX IF NOT EXISTS skill_scan_results_org_skill_idx
  ON skill_scan_results (org_id, skill_name, created_at DESC);
