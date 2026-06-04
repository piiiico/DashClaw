-- Bound the learning-analytics rollup tables.
-- computeVelocity()/computeLearningCurves() (app/lib/learningAnalytics.js) used to
-- plain-INSERT on every run, so learning_velocity and learning_curves grew without
-- bound (one fresh row per agent per compute call). Collapse each to one row per
-- natural key and add a UNIQUE index so the code can ON CONFLICT DO UPDATE.
--
-- Both steps are idempotent and safe to re-run: the dedup DELETE keeps the
-- physically-last row (max ctid) per key and is a no-op once unique; the index
-- uses IF NOT EXISTS. The unique INDEX (not a named CONSTRAINT) is deliberate so
-- IF NOT EXISTS works and it still serves as an ON CONFLICT arbiter.

-- learning_velocity: one current snapshot per (org_id, agent_id, period)
DELETE FROM learning_velocity a
  USING learning_velocity b
  WHERE a.org_id = b.org_id
    AND a.agent_id = b.agent_id
    AND a.period IS NOT DISTINCT FROM b.period
    AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_velocity_org_agent_period
  ON learning_velocity (org_id, agent_id, period);

-- learning_curves: one row per (org_id, agent_id, action_type, window_start)
DELETE FROM learning_curves a
  USING learning_curves b
  WHERE a.org_id = b.org_id
    AND a.agent_id = b.agent_id
    AND a.action_type = b.action_type
    AND a.window_start = b.window_start
    AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_curves_org_agent_action_window
  ON learning_curves (org_id, agent_id, action_type, window_start);
