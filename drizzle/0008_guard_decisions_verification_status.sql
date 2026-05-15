-- Phase 2: JWKS verification status on guard_decisions
-- Enum values: verified | unverified | expired | failed | unknown_issuer
-- Default 'unverified' keeps all existing rows valid without a backfill.
ALTER TABLE guard_decisions
  ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'unverified';
