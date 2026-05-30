-- Phase 2c: action binding (issue #121, design by @piiiico, scoped + corrected
-- in review). Binds a verified token to ONE intended (action, target, goal)
-- tuple via a namespaced `urn:dashclaw:act-binding` claim; the guard records
-- whether the incoming call matches the digest the issuer committed to at mint
-- time. Own axis, like replay_status — it never overloads verification_status.
--
-- act_status enum: not_applicable | match | mismatch | not_present
--                  | unsupported_typ | ctx_incomplete
-- Default 'not_applicable' keeps existing rows valid without a backfill.
ALTER TABLE guard_decisions
  ADD COLUMN IF NOT EXISTS act_status TEXT DEFAULT 'not_applicable';

-- Forensic only: the claim-side digest the token committed to (the unfakeable
-- half). Nullable — null when no binding claim was present. We never store a
-- hash recomputed over the request context, which is redacted before storage.
ALTER TABLE guard_decisions
  ADD COLUMN IF NOT EXISTS act_hash TEXT;

-- Partial index for "show me the binding mismatches" forensic queries. Same
-- shape as idx_guard_decisions_replayed so the planner reuses the path.
CREATE INDEX IF NOT EXISTS idx_guard_decisions_act_mismatch
  ON guard_decisions(org_id, created_at DESC)
  WHERE act_status = 'mismatch';
