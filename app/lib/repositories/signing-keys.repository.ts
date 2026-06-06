/**
 * Repository for the instance-global Ed25519 server signing key.
 *
 * Not org-scoped: the DashClaw instance is the issuer of proof receipts and
 * signed compliance bundles and publishes one JWKS. A constant `id` ('default')
 * makes the active key a singleton so concurrent cold starts can't create two
 * competing keys.
 */
import type { SqlTag } from '../types/db';

interface SigningKeyRow {
  kid: string;
  alg: string;
  private_jwk: string;
  public_jwk: string;
}

interface InsertSigningKeyInput {
  id?: string;
  kid: string;
  alg?: string;
  privateJwk: string;
  publicJwk: string;
}

export async function getActiveSigningKey(sql: SqlTag): Promise<SigningKeyRow | null> {
  const rows = await sql`
    SELECT kid, alg, private_jwk, public_jwk
    FROM server_signing_keys
    WHERE active = 1
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return (rows[0] ?? null) as SigningKeyRow | null;
}

/**
 * Insert the signing key, singleton-guarded. Returns true when THIS call
 * persisted the row (RETURNING yielded it), false when a concurrent caller
 * won the race (ON CONFLICT DO NOTHING) — the loser should re-read.
 */
export async function insertSigningKey(
  sql: SqlTag,
  { id = 'default', kid, alg = 'EdDSA', privateJwk, publicJwk }: InsertSigningKeyInput
): Promise<boolean> {
  const rows = await sql`
    INSERT INTO server_signing_keys (id, kid, alg, private_jwk, public_jwk, active)
    VALUES (${id}, ${kid}, ${alg}, ${privateJwk}, ${publicJwk}, 1)
    ON CONFLICT (id) DO NOTHING
    RETURNING kid
  `;
  return rows.length > 0;
}

export async function listPublicJwks(sql: SqlTag): Promise<unknown[]> {
  const rows = await sql`
    SELECT public_jwk
    FROM server_signing_keys
    WHERE active = 1
    ORDER BY created_at DESC
  `;
  return rows.map((r) => (typeof r.public_jwk === 'string' ? JSON.parse(r.public_jwk) : r.public_jwk));
}
