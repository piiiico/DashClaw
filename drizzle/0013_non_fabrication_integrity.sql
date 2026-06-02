-- Non-fabrication integrity: the GroundLock verifier + signed-evidence logic,
-- ported in as native DashClaw modules. This migration adds the instance signing
-- key store and the per-decision signed-evidence column.

-- Instance-global Ed25519 signing key used to sign proof receipts and compliance
-- bundles. NOT org-scoped: the DashClaw instance is the issuer, and its public
-- key is published once via JWKS. A constant id ('default') makes the active key
-- a singleton so concurrent cold starts cannot create two competing keys. Hybrid
-- storage: an operator may instead set DASHCLAW_SIGNING_KEY_JWK, in which case
-- this table stays empty and the env key is used.
CREATE TABLE IF NOT EXISTS server_signing_keys (
  id TEXT PRIMARY KEY,
  kid TEXT NOT NULL,
  alg TEXT NOT NULL DEFAULT 'EdDSA',
  private_jwk TEXT NOT NULL,
  public_jwk TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Signed evidence for a non_fabrication guard decision: the proof receipt plus
-- the structured violations. JSON text, nullable — null for every decision that
-- did not run a non_fabrication policy, so existing rows stay valid with no
-- backfill (same shape as the Phase 2b/2c column additions).
ALTER TABLE guard_decisions
  ADD COLUMN IF NOT EXISTS evidence TEXT;
