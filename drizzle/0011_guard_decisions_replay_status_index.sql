-- Phase 2b follow-up: aggregate-friendly index on (org_id, replay_status).
--
-- The partial index from 0010 (idx_guard_decisions_replayed) covers the
-- "show me only the replays" forensic query, but a dashboard query like
--   SELECT replay_status, COUNT(*)
--   FROM guard_decisions WHERE org_id = $1 GROUP BY replay_status
-- has to fall back to a full per-org scan because the partial index
-- excludes every other status. This plain index serves the GROUP BY shape
-- and is small (one row per decision, on a low-cardinality column).
CREATE INDEX IF NOT EXISTS idx_guard_decisions_org_replay_status
  ON guard_decisions(org_id, replay_status);
