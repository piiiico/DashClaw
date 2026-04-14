-- Phase 1: agent attribution — add agent_name to guard_decisions
-- Enables trust-on-assertion attribution: callers can pass agent_name
-- alongside agent_id, and it is stored verbatim on every audit entry.
-- No verification in Phase 1; cross-org JWKS verification comes in Phase 2.

ALTER TABLE "guard_decisions" ADD COLUMN "agent_name" text;
