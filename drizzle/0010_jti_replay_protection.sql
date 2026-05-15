-- Phase 2b: JWT replay protection (closes the capture-and-replay gap
-- left by Phase 2). Design by @piiiico in issue #120.
--
-- Composite PK (issuer, jti) reflects RFC 7519: jti uniqueness is
-- per-issuer. expires_at mirrors the token's exp so rows become
-- purgeable at the same instant the token does. agent_id is forensic
-- only — never read for validation, never used as a key.
CREATE TABLE IF NOT EXISTS jwt_replay_log (
  issuer     TEXT   NOT NULL,
  jti        TEXT   NOT NULL,
  expires_at BIGINT NOT NULL,
  seen_at    BIGINT NOT NULL,
  agent_id   TEXT,
  PRIMARY KEY (issuer, jti)
);

CREATE INDEX IF NOT EXISTS idx_jwt_replay_log_expires
  ON jwt_replay_log(expires_at);

-- Add replay_status + jti to guard_decisions so every verified guard
-- call records its replay-check outcome alongside the signature outcome.
-- Default 'not_applicable' keeps existing rows valid without a backfill.
-- Enum values: not_applicable | unique | replayed | not_present | unavailable | exp_too_far
ALTER TABLE guard_decisions
  ADD COLUMN IF NOT EXISTS replay_status TEXT DEFAULT 'not_applicable';

ALTER TABLE guard_decisions
  ADD COLUMN IF NOT EXISTS jti TEXT;

-- Partial index for forensic "show me the replays" queries. Matches the
-- shape of idx_guard_decisions_org_created so the same query planner
-- path handles both filtered and unfiltered timelines.
CREATE INDEX IF NOT EXISTS idx_guard_decisions_replayed
  ON guard_decisions(org_id, created_at DESC)
  WHERE replay_status = 'replayed';
