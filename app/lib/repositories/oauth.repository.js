// app/lib/repositories/oauth.repository.js
// All functions take `sql` (the neon tagged-template) as the first arg, matching
// app/lib/repositories/signing-keys.repository.js.

export async function registerClient(sql, { clientId, clientName, redirectUris, scope }) {
  await sql`
    INSERT INTO oauth_clients (client_id, client_name, redirect_uris, scope)
    VALUES (${clientId}, ${clientName || null}, ${JSON.stringify(redirectUris)}, ${scope || null})
    ON CONFLICT (client_id) DO NOTHING
  `;
}

export async function getClient(sql, clientId) {
  const rows = await sql`
    SELECT client_id, client_name, redirect_uris, scope, token_endpoint_auth_method, grant_types
    FROM oauth_clients WHERE client_id = ${clientId} LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    clientId: r.client_id,
    clientName: r.client_name,
    scope: r.scope,
    redirectUris: typeof r.redirect_uris === 'string' ? JSON.parse(r.redirect_uris) : r.redirect_uris,
  };
}

export async function insertAuthCode(sql, c) {
  await sql`
    INSERT INTO oauth_authorization_codes
      (code_hash, client_id, org_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, agent_id, expires_at)
    VALUES
      (${c.codeHash}, ${c.clientId}, ${c.orgId}, ${c.userId || null}, ${c.redirectUri},
       ${c.codeChallenge}, ${c.codeChallengeMethod || 'S256'}, ${c.scope || null}, ${c.agentId || 'claude-desktop'}, ${c.expiresAt})
  `;
}

// Single-use + unexpired: returns the row only if THIS call consumed it.
export async function consumeAuthCode(sql, codeHash) {
  const rows = await sql`
    UPDATE oauth_authorization_codes
    SET consumed_at = NOW()
    WHERE code_hash = ${codeHash} AND consumed_at IS NULL AND expires_at > NOW()
    RETURNING client_id, org_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, agent_id
  `;
  return rows[0] || null;
}

export async function insertAccessToken(sql, t) {
  await sql`
    INSERT INTO oauth_access_tokens
      (token_hash, refresh_token_hash, client_id, org_id, user_id, scope, agent_id, expires_at)
    VALUES
      (${t.tokenHash}, ${t.refreshTokenHash || null}, ${t.clientId}, ${t.orgId}, ${t.userId || null},
       ${t.scope || null}, ${t.agentId || 'claude-desktop'}, ${t.expiresAt})
  `;
}

export async function resolveAccessToken(sql, tokenHash) {
  const rows = await sql`
    SELECT t.org_id, t.scope, t.agent_id, t.expires_at, t.revoked_at, o.plan
    FROM oauth_access_tokens t
    LEFT JOIN organizations o ON o.id = t.org_id
    WHERE t.token_hash = ${tokenHash} LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  if (r.revoked_at) return null;
  if (new Date(r.expires_at).getTime() <= Date.now()) return null;
  return { orgId: r.org_id, scope: r.scope, agentId: r.agent_id, plan: r.plan };
}

// Rotation: read the row for a refresh token, then revoke it (caller issues a new pair).
export async function rotateRefreshToken(sql, refreshTokenHash) {
  const rows = await sql`
    SELECT client_id, org_id, user_id, scope, agent_id
    FROM oauth_access_tokens
    WHERE refresh_token_hash = ${refreshTokenHash} AND revoked_at IS NULL
      AND created_at > NOW() - INTERVAL '30 days'
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  await sql`UPDATE oauth_access_tokens SET revoked_at = NOW() WHERE refresh_token_hash = ${refreshTokenHash}`;
  const r = rows[0];
  return { clientId: r.client_id, orgId: r.org_id, userId: r.user_id, scope: r.scope, agentId: r.agent_id };
}

/**
 * Garbage-collect OAuth rows that can no longer authenticate anything. Safe to run
 * on a schedule — every resolution path already rejects these rows:
 *  - authorization codes are one-time and short-lived: drop once consumed or expired.
 *  - access tokens: drop once revoked, or older than the 30-day refresh window
 *    (rotateRefreshToken refuses anything with created_at older than 30 days, so
 *    such rows are dead for both access and refresh — never for live tokens).
 * Returns the per-table delete counts.
 */
export async function purgeExpired(sql) {
  const codes = await sql`
    DELETE FROM oauth_authorization_codes
    WHERE consumed_at IS NOT NULL OR expires_at < NOW()
    RETURNING 1
  `;
  const tokens = await sql`
    DELETE FROM oauth_access_tokens
    WHERE revoked_at IS NOT NULL OR created_at < NOW() - INTERVAL '30 days'
    RETURNING 1
  `;
  return { codes: codes.length, tokens: tokens.length };
}
