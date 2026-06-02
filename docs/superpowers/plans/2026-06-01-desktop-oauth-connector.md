# Desktop OAuth Connector (Leg 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/api/mcp` addable as a Claude **custom remote connector** by standing up a minimal OAuth 2.1 authorization server in front of it (DCR + PKCE), so any Claude user pastes `https://<instance>/api/mcp`, authorizes once, and uses the 23 governance tools — while the legacy `x-api-key` path keeps working for Managed Agents.

**Architecture:** DashClaw becomes a small OAuth AS. New tables (`oauth_clients`, `oauth_authorization_codes`, `oauth_access_tokens`) back three flows: Dynamic Client Registration (Anthropic registers a public client), the PKCE authorization-code grant (the operator authorizes via the existing NextAuth login + a consent screen), and opaque access/refresh tokens that resolve to an org exactly like an `api_keys` row. The middleware gains a `Bearer` auth path alongside `x-api-key`, and returns `401 + WWW-Authenticate` on `/api/mcp` so Claude triggers OAuth discovery. The MCP proxy route forwards the caller's credential to its internal callbacks.

**Tech Stack:** Next.js 16 App Router route handlers (Node runtime), Edge middleware, Postgres via Neon (`neon()` in middleware, `getSql()` in routes), drizzle schema + raw SQL migration, `next-auth/jwt` `getToken`, Vitest.

---

## Reference facts (verified — do not re-derive)

- **Claude connector auth (the constraint this plan satisfies):** static API keys / custom headers / URL tokens are PROHIBITED; only OAuth, authless, or `custom_connection` are accepted. OAuth requires **PKCE S256** (mandatory), authorization-server metadata discovery (RFC 8414) + protected-resource metadata (RFC 9728), `401 + WWW-Authenticate` detection, `/token` accepting `application/x-www-form-urlencoded`, and the hosted callback `https://claude.ai/api/mcp/auth_callback`. DCR (RFC 7591) is required unless CIMD is supported. Source: https://claude.com/docs/connectors/building/authentication
- **Locked decisions** (from the design spec): DCR (not CIMD); opaque DB-backed tokens (not JWT); keep `x-api-key`; `governance:read`/`governance:write` scopes.
- **Existing auth flow** (`middleware.js`): `/api/*` is default-deny with a `PUBLIC_ROUTES` allowlist. Protected block reads `x-api-key`, hashes via `hashApiKey()` (Web Crypto SHA-256 → hex), resolves via `resolveApiKey(keyHash)` against `api_keys ⋈ organizations`, then sets `x-org-id`/`x-org-role` on `requestHeaders` and `NextResponse.next({ request: { headers } })`. The stripped header set does NOT strip `Authorization`, so it passes through to the route.
- **`.well-known` pattern:** `middleware.js` config `matcher` lists `/.well-known/jwks.json`; `next.config.js` `rewrites()` maps it to `/api/integrity/jwks`; a special-case block at the top of `middleware()` applies rate-limit + security headers and passes it through. Mirror this for the two OAuth metadata paths.
- **IDs:** `prefix_${crypto.randomUUID()}` (e.g. `usr_…` in `app/lib/auth.js`). Reuse for `ocl_` client IDs.
- **Sessions:** `getToken({ req, secret: process.env.NEXTAUTH_SECRET })` returns `{ userId, orgId, role, plan }` (see `middleware.js:1256` and `app/lib/auth.js`).
- **Repository style:** functions take `sql` as the first arg and use tagged templates (see `app/lib/repositories/signing-keys.repository.js`). `getSql()` is from `app/lib/db.js`.
- **Route test style:** `__tests__/unit/mcp-route.test.js` — `makeRequest()` from `../helpers.js`, `vi.mock()` the deps, dynamic `import()` of the route.
- **`DashClawClient`** (`mcp-server/lib/client.js`) sends `{ 'x-api-key': this.apiKey }` on every call — Task 8 adds an optional `authHeader`.

## File structure

- Create `drizzle/0014_oauth_connector.sql` — the three tables (raw SQL migration).
- Modify `schema/schema.js` — drizzle defs for the three tables (ORM/livingcode parity).
- Create `app/lib/oauth/crypto.js` — pure: token/id generation, SHA-256 hex, PKCE S256 verify.
- Create `app/lib/repositories/oauth.repository.js` — client/code/token persistence (takes `sql`).
- Create `app/api/oauth/metadata/authorization-server/route.js` — RFC 8414 metadata.
- Create `app/api/oauth/metadata/protected-resource/route.js` — RFC 9728 metadata.
- Create `app/api/oauth/register/route.js` — DCR.
- Create `app/api/oauth/authorize/route.js` — session + consent + issue code.
- Create `app/api/oauth/token/route.js` — code→token (PKCE) + refresh.
- Modify `middleware.js` — `resolveOAuthToken`, Bearer path, `/api/mcp` 401+WWW-Authenticate, `PUBLIC_ROUTES`, `matcher`, `.well-known` special-case.
- Modify `next.config.js` — two `.well-known/oauth-*` rewrites.
- Modify `mcp-server/lib/client.js` — optional `authHeader`.
- Modify `app/api/mcp/route.js` — forward caller credential to `DashClawClient`.
- Tests: `__tests__/unit/oauth-crypto.test.js`, `oauth-repository.test.js`, `oauth-metadata.test.js`, `oauth-register.test.js`, `oauth-authorize.test.js`, `oauth-token.test.js`, extend `__tests__/unit/middleware-auth.test.js`, extend `__tests__/unit/mcp-route.test.js`.

---

### Task 1: Schema + migration (three OAuth tables)

**Files:**
- Create: `drizzle/0014_oauth_connector.sql`
- Modify: `schema/schema.js` (append after the `apiKeys` table, before "--- Action & Governance Tables ---" or at the governance section)
- Test: `__tests__/unit/oauth-schema.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// __tests__/unit/oauth-schema.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('0014 oauth migration', () => {
  const sql = readFileSync(join(ROOT, 'drizzle', '0014_oauth_connector.sql'), 'utf8');
  it('creates the three oauth tables idempotently', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS oauth_clients/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS oauth_authorization_codes/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS oauth_access_tokens/);
  });
  it('stores hashes, not raw tokens', () => {
    expect(sql).toMatch(/code_hash TEXT PRIMARY KEY/);
    expect(sql).toMatch(/token_hash TEXT PRIMARY KEY/);
  });
});

describe('schema.js oauth drizzle defs', () => {
  const schema = readFileSync(join(ROOT, 'schema', 'schema.js'), 'utf8');
  it('exports the three oauth tables', () => {
    expect(schema).toMatch(/export const oauthClients = pgTable\('oauth_clients'/);
    expect(schema).toMatch(/export const oauthAuthorizationCodes = pgTable\('oauth_authorization_codes'/);
    expect(schema).toMatch(/export const oauthAccessTokens = pgTable\('oauth_access_tokens'/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/oauth-schema.test.js`
Expected: FAIL — migration file missing.

- [ ] **Step 3: Write the migration**

```sql
-- drizzle/0014_oauth_connector.sql
-- OAuth 2.1 authorization server for the Claude remote MCP connector.
-- DashClaw becomes a minimal AS in front of /api/mcp: DCR-registered public
-- clients (PKCE, no secret), short-lived authorization codes, and opaque
-- access/refresh tokens that resolve to an org (like an api_keys row).

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,                  -- ocl_ prefix
  client_name TEXT,
  redirect_uris TEXT NOT NULL,                 -- JSON array of allowed redirect URIs
  grant_types TEXT NOT NULL DEFAULT 'authorization_code,refresh_token',
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  scope TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,                  -- SHA-256 hex of the issued code
  client_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  scope TEXT,
  agent_id TEXT,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  token_hash TEXT PRIMARY KEY,                 -- SHA-256 hex of the access token
  refresh_token_hash TEXT,                     -- SHA-256 hex of the refresh token (nullable)
  client_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT,
  scope TEXT,
  agent_id TEXT NOT NULL DEFAULT 'claude-desktop',
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oauth_access_tokens_refresh_idx ON oauth_access_tokens (refresh_token_hash);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_org_idx ON oauth_access_tokens (org_id);
```

- [ ] **Step 4: Add drizzle defs to `schema/schema.js`**

Insert after the `apiKeys` table (after line 66), keeping the `// @domain governance` tag style:

```javascript
// @domain governance
export const oauthClients = pgTable('oauth_clients', {
  clientId: text('client_id').primaryKey(), // ocl_ prefix
  clientName: text('client_name'),
  redirectUris: text('redirect_uris').notNull(), // JSON array
  grantTypes: text('grant_types').notNull().default('authorization_code,refresh_token'),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull().default('none'),
  scope: text('scope'),
  createdAt: timestamp('created_at').defaultNow(),
});

// @domain governance
export const oauthAuthorizationCodes = pgTable('oauth_authorization_codes', {
  codeHash: text('code_hash').primaryKey(),
  clientId: text('client_id').notNull(),
  orgId: text('org_id').notNull(),
  userId: text('user_id'),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
  scope: text('scope'),
  agentId: text('agent_id'),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// @domain governance
export const oauthAccessTokens = pgTable('oauth_access_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  refreshTokenHash: text('refresh_token_hash'),
  clientId: text('client_id').notNull(),
  orgId: text('org_id').notNull(),
  userId: text('user_id'),
  scope: text('scope'),
  agentId: text('agent_id').notNull().default('claude-desktop'),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

- [ ] **Step 5: Apply the migration locally and run the test**

Run: `npm run db:migrate` (per the repo gotcha: required after any `schema/` or `drizzle/` change, or middleware silently 401s).
Then: `npx vitest run __tests__/unit/oauth-schema.test.js`
Expected: migration applies; tests PASS.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0014_oauth_connector.sql schema/schema.js __tests__/unit/oauth-schema.test.js
git commit -m "feat(oauth): add oauth_clients/codes/tokens tables for the MCP connector"
```

---

### Task 2: OAuth crypto utilities (pure)

**Files:**
- Create: `app/lib/oauth/crypto.js`
- Test: `__tests__/unit/oauth-crypto.test.js`

- [ ] **Step 1: Write the failing test** (PKCE vector is the RFC 7636 Appendix B example)

```javascript
// __tests__/unit/oauth-crypto.test.js
import { describe, it, expect } from 'vitest';
import { base64url, sha256Hex, hashToken, newOpaqueToken, newId, verifyPkceS256 } from '../../app/lib/oauth/crypto.js';

describe('oauth crypto', () => {
  it('sha256Hex matches the middleware hashApiKey format (lowercase hex)', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashToken('abc')).toBe(sha256Hex('abc'));
  });

  it('verifyPkceS256 accepts the RFC 7636 example pair', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it('verifyPkceS256 rejects mismatches and empties', () => {
    expect(verifyPkceS256('wrong', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false);
    expect(verifyPkceS256('', '')).toBe(false);
    expect(verifyPkceS256('a', undefined)).toBe(false);
  });

  it('newOpaqueToken and newId carry their prefix and are unique', () => {
    const a = newOpaqueToken('oat');
    const b = newOpaqueToken('oat');
    expect(a.startsWith('oat_')).toBe(true);
    expect(a).not.toBe(b);
    expect(newId('ocl').startsWith('ocl_')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/oauth-crypto.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the utilities**

```javascript
// app/lib/oauth/crypto.js
import crypto from 'node:crypto';

export function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Same hex digest the Edge middleware produces via hashApiKey() (Web Crypto),
// so a token hashed here in a Node route matches a middleware lookup.
export function hashToken(token) {
  return sha256Hex(token);
}

export function newOpaqueToken(prefix) {
  return `${prefix}_${base64url(crypto.randomBytes(32))}`;
}

export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

// PKCE S256: base64url(SHA-256(verifier)) === challenge, constant-time.
export function verifyPkceS256(verifier, challenge) {
  if (typeof verifier !== 'string' || typeof challenge !== 'string' || !verifier || !challenge) {
    return false;
  }
  const computed = base64url(crypto.createHash('sha256').update(verifier).digest());
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/oauth-crypto.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/oauth/crypto.js __tests__/unit/oauth-crypto.test.js
git commit -m "feat(oauth): add PKCE S256 + token/id crypto utilities"
```

---

### Task 3: OAuth repository

**Files:**
- Create: `app/lib/repositories/oauth.repository.js`
- Test: `__tests__/unit/oauth-repository.test.js`

- [ ] **Step 1: Write the failing test** (sql is stubbed like the signing-keys repo tests)

```javascript
// __tests__/unit/oauth-repository.test.js
import { describe, it, expect, vi } from 'vitest';
import {
  registerClient, getClient, insertAuthCode, consumeAuthCode,
  insertAccessToken, resolveAccessToken, rotateRefreshToken,
} from '../../app/lib/repositories/oauth.repository.js';

// A tagged-template stub: records the last call and returns a queued result.
function makeSql(result = []) {
  const sql = vi.fn(() => Promise.resolve(result));
  return sql;
}

describe('oauth.repository', () => {
  it('getClient parses redirect_uris JSON', async () => {
    const sql = makeSql([{ client_id: 'ocl_1', redirect_uris: '["https://claude.ai/api/mcp/auth_callback"]' }]);
    const client = await getClient(sql, 'ocl_1');
    expect(client.redirectUris).toEqual(['https://claude.ai/api/mcp/auth_callback']);
  });

  it('getClient returns null when absent', async () => {
    expect(await getClient(makeSql([]), 'nope')).toBeNull();
  });

  it('resolveAccessToken rejects expired tokens', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const sql = makeSql([{ org_id: 'org_1', expires_at: past, revoked_at: null, scope: 'governance:write', agent_id: 'claude-desktop' }]);
    expect(await resolveAccessToken(sql, 'h')).toBeNull();
  });

  it('resolveAccessToken returns org for a valid token', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const sql = makeSql([{ org_id: 'org_1', expires_at: future, revoked_at: null, scope: 'governance:write', agent_id: 'claude-desktop', plan: 'free' }]);
    const r = await resolveAccessToken(sql, 'h');
    expect(r.orgId).toBe('org_1');
    expect(r.agentId).toBe('claude-desktop');
  });

  it('consumeAuthCode returns the row the UPDATE…RETURNING yields', async () => {
    const sql = makeSql([{ client_id: 'ocl_1', org_id: 'org_1', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: 'c', code_challenge_method: 'S256', scope: null, agent_id: 'claude-desktop', user_id: 'usr_1' }]);
    const row = await consumeAuthCode(sql, 'codehash');
    expect(row.org_id).toBe('org_1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/oauth-repository.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the repository**

```javascript
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
    WHERE refresh_token_hash = ${refreshTokenHash} AND revoked_at IS NULL LIMIT 1
  `;
  if (rows.length === 0) return null;
  await sql`UPDATE oauth_access_tokens SET revoked_at = NOW() WHERE refresh_token_hash = ${refreshTokenHash}`;
  const r = rows[0];
  return { clientId: r.client_id, orgId: r.org_id, userId: r.user_id, scope: r.scope, agentId: r.agent_id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/oauth-repository.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/repositories/oauth.repository.js __tests__/unit/oauth-repository.test.js
git commit -m "feat(oauth): add oauth repository (clients, codes, tokens)"
```

---

### Task 4: Metadata endpoints + public-route wiring

**Files:**
- Create: `app/api/oauth/metadata/authorization-server/route.js`
- Create: `app/api/oauth/metadata/protected-resource/route.js`
- Modify: `next.config.js` (add two rewrites)
- Modify: `middleware.js` (`PUBLIC_ROUTES` + `matcher` + `.well-known` special-case)
- Test: `__tests__/unit/oauth-metadata.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// __tests__/unit/oauth-metadata.test.js
import { describe, it, expect } from 'vitest';
import { makeRequest } from '../helpers.js';
import { GET as asGet } from '../../app/api/oauth/metadata/authorization-server/route.js';
import { GET as prGet } from '../../app/api/oauth/metadata/protected-resource/route.js';

describe('oauth metadata', () => {
  it('authorization-server metadata advertises S256 + endpoints', async () => {
    const res = await asGet(makeRequest('https://x.dashclaw.app/api/oauth/metadata/authorization-server', { method: 'GET', headers: { host: 'x.dashclaw.app' } }));
    const m = await res.json();
    expect(m.issuer).toBe('https://x.dashclaw.app');
    expect(m.authorization_endpoint).toBe('https://x.dashclaw.app/api/oauth/authorize');
    expect(m.token_endpoint).toBe('https://x.dashclaw.app/api/oauth/token');
    expect(m.registration_endpoint).toBe('https://x.dashclaw.app/api/oauth/register');
    expect(m.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('protected-resource metadata points at /api/mcp and the AS', async () => {
    const res = await prGet(makeRequest('https://x.dashclaw.app/api/oauth/metadata/protected-resource', { method: 'GET', headers: { host: 'x.dashclaw.app' } }));
    const m = await res.json();
    expect(m.resource).toBe('https://x.dashclaw.app/api/mcp');
    expect(m.authorization_servers).toEqual(['https://x.dashclaw.app']);
  });
});
```

> NOTE: confirm `makeRequest` forwards a `host` header and supports `method: 'GET'`; if its signature differs, adapt the call to set `host` via `headers`. (Check `__tests__/helpers.js` first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/oauth-metadata.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write a shared issuer helper + both routes**

```javascript
// app/api/oauth/metadata/authorization-server/route.js
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export function issuerBase(request) {
  if (process.env.DASHCLAW_URL) return process.env.DASHCLAW_URL.replace(/\/$/, '');
  const host = request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}

export async function GET(request) {
  const base = issuerBase(request);
  return NextResponse.json({
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['governance:read', 'governance:write'],
  });
}
```

```javascript
// app/api/oauth/metadata/protected-resource/route.js
import { NextResponse } from 'next/server';
import { issuerBase } from '../authorization-server/route.js';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const base = issuerBase(request);
  return NextResponse.json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
  });
}
```

- [ ] **Step 4: Add the two rewrites to `next.config.js`**

In the `rewrites()` array (next to the jwks rewrite at `next.config.js:51`), add:

```javascript
      { source: '/.well-known/oauth-authorization-server', destination: '/api/oauth/metadata/authorization-server' },
      { source: '/.well-known/oauth-protected-resource', destination: '/api/oauth/metadata/protected-resource' },
```

- [ ] **Step 5: Wire middleware (public routes + matcher + .well-known headers)**

In `middleware.js`, add to the `PUBLIC_ROUTES` array:

```javascript
  '/api/oauth',  // OAuth AS endpoints self-authenticate (authorize checks session; token verifies PKCE; register is DCR-open)
```

Add to the `config.matcher` array (next to `'/.well-known/jwks.json'`):

```javascript
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
```

Add a special-case block at the top of `middleware()`, mirroring the existing `/.well-known/jwks.json` block (apply rate-limit + security headers, then pass through so the rewrite resolves):

```javascript
  // Public OAuth metadata discovery (RFC 8414 / 9728). Rewritten by next.config.js
  // to /api/oauth/metadata/* — apply the same rate-limit + headers the canonical
  // /api path gets, then pass through (public, no auth), exactly like jwks.json.
  if (pathname === '/.well-known/oauth-authorization-server' || pathname === '/.well-known/oauth-protected-resource') {
    const trustProxy = ['1', 'true', 'yes', 'on'].includes(String(process.env.TRUST_PROXY || process.env.VERCEL || '').toLowerCase());
    const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    let ip = (trustProxy ? (fwd || request.headers.get('x-real-ip')) : null) || request.ip || 'unknown';
    if (ip === 'unknown' && process.env.NODE_ENV === 'development') ip = fwd || '127.0.0.1';
    if (!(await checkRateLimit(`${ip}:${pathname}`))) {
      return securedJson(request, { error: 'Rate limit exceeded. Please slow down.' }, { status: 429, headers: { 'Retry-After': '60' } });
    }
    const response = NextResponse.next();
    addSecurityHeaders(response, request);
    withCors(request, response);
    return response;
  }
```

- [ ] **Step 6: Run the metadata test + full middleware test**

Run: `npx vitest run __tests__/unit/oauth-metadata.test.js __tests__/unit/middleware-auth.test.js`
Expected: PASS (metadata tests pass; middleware tests still green).

- [ ] **Step 7: Commit**

```bash
git add app/api/oauth/metadata next.config.js middleware.js __tests__/unit/oauth-metadata.test.js
git commit -m "feat(oauth): serve RFC 8414/9728 metadata at /.well-known/oauth-*"
```

---

### Task 5: Dynamic Client Registration (`/api/oauth/register`)

**Files:**
- Create: `app/api/oauth/register/route.js`
- Test: `__tests__/unit/oauth-register.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// __tests__/unit/oauth-register.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../helpers.js';

const mockRegister = vi.fn();
vi.mock('../../app/lib/repositories/oauth.repository.js', () => ({ registerClient: mockRegister }));
vi.mock('../../app/lib/db.js', () => ({ getSql: () => vi.fn() }));

const { POST } = await import('../../app/api/oauth/register/route.js');

describe('POST /api/oauth/register', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects registration with no redirect_uris', async () => {
    const res = await POST(makeRequest('https://x/api/oauth/register', { headers: { host: 'x' }, body: { client_name: 'Claude' } }));
    expect(res.status).toBe(400);
  });

  it('registers a public client and returns a client_id', async () => {
    const res = await POST(makeRequest('https://x/api/oauth/register', {
      headers: { host: 'x' },
      body: { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] },
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.client_id).toMatch(/^ocl_/);
    expect(data.token_endpoint_auth_method).toBe('none');
    expect(mockRegister).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/oauth-register.test.js`
Expected: FAIL — route not found.

- [ ] **Step 3: Write the route**

```javascript
// app/api/oauth/register/route.js
import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { registerClient } from '../../../lib/repositories/oauth.repository.js';
import { newId } from '../../../lib/oauth/crypto.js';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter(u => typeof u === 'string') : [];
  if (redirectUris.length === 0) {
    return NextResponse.json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris is required' }, { status: 400 });
  }
  const clientId = newId('ocl');
  await registerClient(getSql(), {
    clientId,
    clientName: typeof body.client_name === 'string' ? body.client_name : null,
    redirectUris,
    scope: typeof body.scope === 'string' ? body.scope : null,
  });
  return NextResponse.json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_method: 'none',
  }, { status: 201 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/oauth-register.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/oauth/register __tests__/unit/oauth-register.test.js
git commit -m "feat(oauth): add Dynamic Client Registration endpoint"
```

---

### Task 6: Authorization endpoint (`/api/oauth/authorize`)

**Files:**
- Create: `app/api/oauth/authorize/route.js`
- Test: `__tests__/unit/oauth-authorize.test.js`

This route requires a logged-in DashClaw user (NextAuth). GET with no session redirects to `/login?callbackUrl=…`. GET with a session validates the request and renders a minimal consent page. POST (consent confirmed) issues a single-use authorization code and redirects to the client's `redirect_uri` with `code` + `state`.

> **Design note (UI):** the consent page is minimal functional HTML. Per the repo's design rule, do not hardcode hex — keep it to plain semantic markup; if it is ever visually polished, read `.impeccable.md` first.

- [ ] **Step 1: Write the failing test**

```javascript
// __tests__/unit/oauth-authorize.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../helpers.js';

const mockGetToken = vi.fn();
const mockGetClient = vi.fn();
const mockInsertCode = vi.fn();
vi.mock('next-auth/jwt', () => ({ getToken: mockGetToken }));
vi.mock('../../app/lib/repositories/oauth.repository.js', () => ({
  getClient: mockGetClient,
  insertAuthCode: mockInsertCode,
}));
vi.mock('../../app/lib/db.js', () => ({ getSql: () => vi.fn() }));

const { GET, POST } = await import('../../app/api/oauth/authorize/route.js');

const VALID_QS =
  'response_type=code&client_id=ocl_1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback' +
  '&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=xyz&scope=governance:write';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClient.mockResolvedValue({ clientId: 'ocl_1', redirectUris: ['https://claude.ai/api/mcp/auth_callback'] });
});

describe('GET /api/oauth/authorize', () => {
  it('redirects to /login when no session', async () => {
    mockGetToken.mockResolvedValue(null);
    const res = await GET(makeRequest(`https://x/api/oauth/authorize?${VALID_QS}`, { method: 'GET', headers: { host: 'x' } }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('renders a consent page when authenticated', async () => {
    mockGetToken.mockResolvedValue({ orgId: 'org_1', userId: 'usr_1' });
    const res = await GET(makeRequest(`https://x/api/oauth/authorize?${VALID_QS}`, { method: 'GET', headers: { host: 'x' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('Authorize');
  });

  it('rejects an unregistered client', async () => {
    mockGetToken.mockResolvedValue({ orgId: 'org_1' });
    mockGetClient.mockResolvedValue(null);
    const res = await GET(makeRequest(`https://x/api/oauth/authorize?${VALID_QS}`, { method: 'GET', headers: { host: 'x' } }));
    expect(res.status).toBe(400);
  });

  it('rejects a redirect_uri not registered to the client', async () => {
    mockGetToken.mockResolvedValue({ orgId: 'org_1' });
    const qs = VALID_QS.replace('https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback', 'https%3A%2F%2Fevil.example%2Fcb');
    const res = await GET(makeRequest(`https://x/api/oauth/authorize?${qs}`, { method: 'GET', headers: { host: 'x' } }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/oauth/authorize', () => {
  it('issues a code and redirects to the client redirect_uri with state', async () => {
    mockGetToken.mockResolvedValue({ orgId: 'org_1', userId: 'usr_1' });
    const res = await POST(makeRequest(`https://x/api/oauth/authorize?${VALID_QS}`, { method: 'POST', headers: { host: 'x' } }));
    expect(res.status).toBe(307);
    const loc = res.headers.get('location');
    expect(loc).toContain('https://claude.ai/api/mcp/auth_callback?code=');
    expect(loc).toContain('state=xyz');
    expect(mockInsertCode).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/oauth-authorize.test.js`
Expected: FAIL — route not found.

- [ ] **Step 3: Write the route**

```javascript
// app/api/oauth/authorize/route.js
import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getSql } from '../../../lib/db.js';
import { getClient, insertAuthCode } from '../../../lib/repositories/oauth.repository.js';
import { newOpaqueToken, hashToken } from '../../../lib/oauth/crypto.js';
export const dynamic = 'force-dynamic';

const CODE_TTL_MS = 5 * 60 * 1000;

function readParams(request) {
  const url = new URL(request.url);
  const p = url.searchParams;
  return {
    responseType: p.get('response_type'),
    clientId: p.get('client_id'),
    redirectUri: p.get('redirect_uri'),
    codeChallenge: p.get('code_challenge'),
    codeChallengeMethod: p.get('code_challenge_method') || 'plain',
    state: p.get('state') || '',
    scope: p.get('scope') || 'governance:write',
  };
}

// Returns { ok, error, client } after validating the request + session.
async function validate(request, session) {
  const q = readParams(request);
  if (q.responseType !== 'code') return { ok: false, error: 'unsupported_response_type' };
  if (q.codeChallengeMethod !== 'S256' || !q.codeChallenge) return { ok: false, error: 'invalid_request: PKCE S256 required' };
  if (!q.clientId || !q.redirectUri) return { ok: false, error: 'invalid_request' };
  const client = await getClient(getSql(), q.clientId);
  if (!client) return { ok: false, error: 'invalid_client' };
  if (!client.redirectUris.includes(q.redirectUri)) return { ok: false, error: 'invalid_redirect_uri' };
  return { ok: true, q, client };
}

export async function GET(request) {
  const session = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!session) {
    const here = new URL(request.url);
    const login = new URL('/login', here);
    login.searchParams.set('callbackUrl', here.pathname + here.search);
    return NextResponse.redirect(login);
  }
  const v = await validate(request, session);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  // Minimal consent page. POSTs back to this same URL (query preserved).
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize DashClaw</title></head>
<body>
<main>
  <h1>Authorize ${v.client.clientName ? v.client.clientName : 'this app'}</h1>
  <p>Grant Claude access to your DashClaw governance tools (guard, record, approvals, audit trail) for this workspace.</p>
  <form method="post">
    <button type="submit">Authorize</button>
  </form>
</main>
</body></html>`;
  return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function POST(request) {
  const session = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!session) return NextResponse.json({ error: 'login_required' }, { status: 401 });
  const v = await validate(request, session);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const code = newOpaqueToken('oac');
  await insertAuthCode(getSql(), {
    codeHash: hashToken(code),
    clientId: v.q.clientId,
    orgId: session.orgId || 'org_default',
    userId: session.userId || null,
    redirectUri: v.q.redirectUri,
    codeChallenge: v.q.codeChallenge,
    codeChallengeMethod: 'S256',
    scope: v.q.scope,
    agentId: 'claude-desktop',
    expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });

  const redirect = new URL(v.q.redirectUri);
  redirect.searchParams.set('code', code);
  if (v.q.state) redirect.searchParams.set('state', v.q.state);
  return NextResponse.redirect(redirect);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/oauth-authorize.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/oauth/authorize __tests__/unit/oauth-authorize.test.js
git commit -m "feat(oauth): add authorization endpoint with session gate + PKCE + consent"
```

---

### Task 7: Token endpoint (`/api/oauth/token`)

**Files:**
- Create: `app/api/oauth/token/route.js`
- Test: `__tests__/unit/oauth-token.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// __tests__/unit/oauth-token.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConsume = vi.fn();
const mockInsertToken = vi.fn();
const mockRotate = vi.fn();
vi.mock('../../app/lib/repositories/oauth.repository.js', () => ({
  consumeAuthCode: mockConsume,
  insertAccessToken: mockInsertToken,
  rotateRefreshToken: mockRotate,
}));
vi.mock('../../app/lib/db.js', () => ({ getSql: () => vi.fn() }));

const { POST } = await import('../../app/api/oauth/token/route.js');

// Builds a urlencoded token request (the transport Claude uses).
function form(params) {
  return new Request('https://x/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

beforeEach(() => vi.clearAllMocks());

describe('POST /api/oauth/token', () => {
  it('exchanges a valid code+verifier for an access token', async () => {
    mockConsume.mockResolvedValue({
      client_id: 'ocl_1', org_id: 'org_1', user_id: 'usr_1',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: CHALLENGE, code_challenge_method: 'S256',
      scope: 'governance:write', agent_id: 'claude-desktop',
    });
    const res = await POST(form({
      grant_type: 'authorization_code', code: 'oac_abc', client_id: 'ocl_1',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_verifier: VERIFIER,
    }));
    expect(res.status).toBe(200);
    const t = await res.json();
    expect(t.token_type).toBe('Bearer');
    expect(t.access_token).toMatch(/^oat_/);
    expect(t.refresh_token).toMatch(/^ort_/);
    expect(t.expires_in).toBeGreaterThan(0);
    expect(mockInsertToken).toHaveBeenCalledOnce();
  });

  it('rejects a bad PKCE verifier', async () => {
    mockConsume.mockResolvedValue({
      client_id: 'ocl_1', org_id: 'org_1', redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: CHALLENGE, code_challenge_method: 'S256', scope: 'governance:write', agent_id: 'claude-desktop',
    });
    const res = await POST(form({
      grant_type: 'authorization_code', code: 'oac_abc', client_id: 'ocl_1',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_verifier: 'WRONG',
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('rejects a consumed/expired/unknown code', async () => {
    mockConsume.mockResolvedValue(null);
    const res = await POST(form({
      grant_type: 'authorization_code', code: 'gone', client_id: 'ocl_1',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_verifier: VERIFIER,
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('rejects a redirect_uri mismatch', async () => {
    mockConsume.mockResolvedValue({
      client_id: 'ocl_1', org_id: 'org_1', redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: CHALLENGE, code_challenge_method: 'S256', scope: 'governance:write', agent_id: 'claude-desktop',
    });
    const res = await POST(form({
      grant_type: 'authorization_code', code: 'oac_abc', client_id: 'ocl_1',
      redirect_uri: 'https://evil.example/cb', code_verifier: VERIFIER,
    }));
    expect(res.status).toBe(400);
  });

  it('rotates a refresh token', async () => {
    mockRotate.mockResolvedValue({ clientId: 'ocl_1', orgId: 'org_1', userId: 'usr_1', scope: 'governance:write', agentId: 'claude-desktop' });
    const res = await POST(form({ grant_type: 'refresh_token', refresh_token: 'ort_old', client_id: 'ocl_1' }));
    expect(res.status).toBe(200);
    const t = await res.json();
    expect(t.access_token).toMatch(/^oat_/);
    expect(mockRotate).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/oauth-token.test.js`
Expected: FAIL — route not found.

- [ ] **Step 3: Write the route**

```javascript
// app/api/oauth/token/route.js
import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { consumeAuthCode, insertAccessToken, rotateRefreshToken } from '../../../lib/repositories/oauth.repository.js';
import { newOpaqueToken, hashToken, verifyPkceS256 } from '../../../lib/oauth/crypto.js';
export const dynamic = 'force-dynamic';

const ACCESS_TTL_S = 60 * 60;          // 1 hour
const ACCESS_TTL_MS = ACCESS_TTL_S * 1000;

function err(code, status = 400) {
  return NextResponse.json({ error: code }, { status });
}

async function issueTokenPair(sql, ctx) {
  const accessToken = newOpaqueToken('oat');
  const refreshToken = newOpaqueToken('ort');
  await insertAccessToken(sql, {
    tokenHash: hashToken(accessToken),
    refreshTokenHash: hashToken(refreshToken),
    clientId: ctx.clientId,
    orgId: ctx.orgId,
    userId: ctx.userId || null,
    scope: ctx.scope,
    agentId: ctx.agentId || 'claude-desktop',
    expiresAt: new Date(Date.now() + ACCESS_TTL_MS).toISOString(),
  });
  return NextResponse.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_S,
    refresh_token: refreshToken,
    scope: ctx.scope,
  });
}

export async function POST(request) {
  const form = new URLSearchParams(await request.text());
  const grantType = form.get('grant_type');
  const sql = getSql();

  if (grantType === 'authorization_code') {
    const code = form.get('code');
    const redirectUri = form.get('redirect_uri');
    const verifier = form.get('code_verifier');
    if (!code || !redirectUri || !verifier) return err('invalid_request');

    const row = await consumeAuthCode(sql, hashToken(code));
    if (!row) return err('invalid_grant');                       // unknown/expired/replayed
    if (row.redirect_uri !== redirectUri) return err('invalid_grant');
    if (!verifyPkceS256(verifier, row.code_challenge)) return err('invalid_grant');

    return issueTokenPair(sql, {
      clientId: row.client_id, orgId: row.org_id, userId: row.user_id,
      scope: row.scope, agentId: row.agent_id,
    });
  }

  if (grantType === 'refresh_token') {
    const refresh = form.get('refresh_token');
    if (!refresh) return err('invalid_request');
    const ctx = await rotateRefreshToken(sql, hashToken(refresh));
    if (!ctx) return err('invalid_grant');
    return issueTokenPair(sql, ctx);
  }

  return err('unsupported_grant_type');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/oauth-token.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/oauth/token __tests__/unit/oauth-token.test.js
git commit -m "feat(oauth): add token endpoint (PKCE auth_code + refresh rotation)"
```

---

### Task 8: Middleware Bearer auth + `/api/mcp` 401 challenge

**Files:**
- Modify: `middleware.js`
- Test: `__tests__/unit/middleware-auth.test.js` (extend)

- [ ] **Step 1: Write the failing tests** (append to the existing describe block)

```javascript
// __tests__/unit/middleware-auth.test.js  (add these cases)
// Assumes the file already mocks '@neondatabase/serverless' neon(). Extend that
// mock so a known token hash resolves to an org and an unknown one does not.

it('returns 401 + WWW-Authenticate on /api/mcp with no credentials', async () => {
  const req = makeRequest('https://x.dashclaw.app/api/mcp', {
    method: 'POST', headers: { host: 'x.dashclaw.app', 'sec-fetch-site': 'cross-site' },
    body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  });
  const res = await middleware(req);
  expect(res.status).toBe(401);
  expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
  expect(res.headers.get('WWW-Authenticate')).toContain('/.well-known/oauth-protected-resource');
});

it('accepts a valid OAuth Bearer token (passes through with org headers)', async () => {
  // Arrange the neon mock so the oauth_access_tokens lookup returns a live token.
  // (See the file's existing neon mock setup; queue a row with a future expires_at.)
  const req = makeRequest('https://x.dashclaw.app/api/mcp', {
    method: 'POST',
    headers: { host: 'x.dashclaw.app', authorization: 'Bearer oat_valid' },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  const res = await middleware(req);
  expect(res.status).not.toBe(401);
});
```

> The exact neon-mock wiring depends on the existing setup in `middleware-auth.test.js` — read that file's `vi.mock('@neondatabase/serverless', …)` and queue the `oauth_access_tokens` row the same way it queues `api_keys` rows.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/middleware-auth.test.js`
Expected: FAIL — no WWW-Authenticate / Bearer path yet.

- [ ] **Step 3: Add `resolveOAuthToken` + a `/api/mcp` challenge helper** (top-level in `middleware.js`, near `resolveApiKey`)

```javascript
// In-memory cache mirrors resolveApiKey (5-min TTL).
const oauthTokenCache = new Map();
const OAUTH_TOKEN_CACHE_TTL = 5 * 60 * 1000;

async function resolveOAuthToken(tokenHash) {
  const now = Date.now();
  const cached = oauthTokenCache.get(tokenHash);
  if (cached && now - cached.timestamp < OAUTH_TOKEN_CACHE_TTL) return cached.result;
  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT org_id, expires_at, revoked_at
      FROM oauth_access_tokens
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `;
    let result = null;
    if (rows.length > 0) {
      const r = rows[0];
      const live = !r.revoked_at && new Date(r.expires_at).getTime() > now;
      if (live) {
        result = { orgId: r.org_id, role: 'member' };
        sql`UPDATE oauth_access_tokens SET last_used_at = NOW() WHERE token_hash = ${tokenHash}`.catch(() => {});
      }
    }
    oauthTokenCache.set(tokenHash, { timestamp: now, result });
    return result;
  } catch (err) {
    console.error('[AUTH] OAuth token lookup failed:', err.message);
    return null;
  }
}

function mcpAuthChallenge(request) {
  const host = request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const base = process.env.DASHCLAW_URL ? process.env.DASHCLAW_URL.replace(/\/$/, '') : `${proto}://${host}`;
  return securedJson(request, { error: 'authorization_required' }, {
    status: 401,
    headers: { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` },
  });
}
```

- [ ] **Step 4: Add the Bearer path inside `if (isProtectedRoute)`** — immediately after `requestHeaders.set('x-client-ip', ip);` (the line at `middleware.js:1220`) and BEFORE `const apiKey = request.headers.get('x-api-key');`:

```javascript
    // OAuth Bearer path (Claude custom connectors). Additive — x-api-key still works.
    const authz = request.headers.get('authorization') || '';
    const bearer = authz.slice(0, 7).toLowerCase() === 'bearer ' ? authz.slice(7).trim() : '';
    if (bearer) {
      const tokenHash = await hashApiKey(bearer); // Web Crypto SHA-256 hex (matches hashToken)
      const oauth = await resolveOAuthToken(tokenHash);
      if (oauth) {
        requestHeaders.set('x-org-id', oauth.orgId);
        requestHeaders.set('x-org-role', oauth.role);
        // Authorization passes through (not stripped) so the /api/mcp proxy can
        // forward it to its own internal callbacks.
        const response = NextResponse.next({ request: { headers: requestHeaders } });
        addSecurityHeaders(response, request);
        for (const [k, v] of Object.entries(getCorsHeaders(request))) response.headers.set(k, v);
        return response;
      }
      // Bad/expired bearer: challenge on /api/mcp so Claude re-runs discovery.
      if (pathname === '/api/mcp') return mcpAuthChallenge(request);
      return securedJson(request, { error: 'Unauthorized - invalid token' }, { status: 401 });
    }
```

- [ ] **Step 5: Challenge on `/api/mcp` when no key is present** — in the existing `if (!apiKey) { … }` block, at the very top of that block add:

```javascript
      // Claude connector discovery: an unauthenticated /api/mcp must answer with
      // 401 + WWW-Authenticate so the client starts the OAuth flow.
      if (pathname === '/api/mcp') return mcpAuthChallenge(request);
```

(Place it before the `sec-fetch-site` same-origin check so cross-site Claude calls get the challenge.)

- [ ] **Step 6: Run the middleware tests + full suite**

Run: `npx vitest run __tests__/unit/middleware-auth.test.js`
Expected: PASS, including the two new cases.

- [ ] **Step 7: Commit**

```bash
git add middleware.js __tests__/unit/middleware-auth.test.js
git commit -m "feat(oauth): accept Bearer tokens + 401/WWW-Authenticate challenge on /api/mcp"
```

---

### Task 9: MCP route forwards the caller credential

The `/api/mcp` proxy re-calls the instance API via `DashClawClient`, which today only sends `x-api-key`. When a caller authenticates with a Bearer token (no `x-api-key`), the internal callbacks must carry that `Authorization` header so middleware re-resolves them.

**Files:**
- Modify: `mcp-server/lib/client.js`
- Modify: `app/api/mcp/route.js`
- Test: `__tests__/unit/mcp-route.test.js` (extend) + `mcp-server` client behavior covered in `oauth` path

- [ ] **Step 1: Write the failing test** (append to `__tests__/unit/mcp-route.test.js`)

```javascript
it('forwards an Authorization: Bearer header to the DashClawClient', async () => {
  // The route constructs a DashClawClient from request headers. Assert that a
  // Bearer-authenticated request produces a client configured with authHeader.
  // (This test imports the REAL client to assert header construction.)
  const { DashClawClient } = await import('../../mcp-server/lib/client.js');
  const c = new DashClawClient({ url: 'http://localhost:3000', authHeader: 'Bearer oat_x' });
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
  await c.post('/api/guard', {});
  const [, opts] = spy.mock.calls[0];
  expect(opts.headers.Authorization).toBe('Bearer oat_x');
  expect(opts.headers['x-api-key']).toBeUndefined();
  spy.mockRestore();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/mcp-route.test.js`
Expected: FAIL — `authHeader` not supported.

- [ ] **Step 3: Add `authHeader` to `DashClawClient`**

In `mcp-server/lib/client.js`, update the constructor and the three header blocks. Constructor:

```javascript
  constructor({ url, apiKey, agentId, authHeader } = {}) {
    this.baseUrl = (url || 'http://localhost:3000').replace(/\/$/, '');
    this.apiKey = apiKey || '';
    this.agentId = agentId || '';
    this.authHeader = authHeader || '';
  }

  // Build auth headers: prefer an explicit Authorization (OAuth) over x-api-key.
  _authHeaders() {
    return this.authHeader ? { Authorization: this.authHeader } : { 'x-api-key': this.apiKey };
  }
```

Then in `post`, `patch`, and `fetch`, replace `'x-api-key': this.apiKey` with `...this._authHeaders()`, and in `get` replace `headers: { 'x-api-key': this.apiKey }` with `headers: { ...this._authHeaders() }`. Example for `post`:

```javascript
        headers: {
          'Content-Type': 'application/json',
          ...this._authHeaders(),
        },
```

- [ ] **Step 4: Forward the credential in the MCP route**

In `app/api/mcp/route.js`, update `resolveConfig` and the client construction:

```javascript
function resolveConfig(request) {
  const apiKey = request.headers.get('x-api-key') || '';
  const authHeader = request.headers.get('authorization') || '';
  const origin = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.DASHCLAW_URL || 'http://localhost:3000';
  return { url: origin, apiKey, authHeader };
}
```

and where the client is built (`const client = new DashClawClient(config);`) — `config` now includes `authHeader`, so the constructor picks it up. No other change needed.

- [ ] **Step 5: Run the MCP route tests + the publish-package tests**

Run: `npx vitest run __tests__/unit/mcp-route.test.js __tests__/unit/mcp-tools.test.js __tests__/unit/mcp-tools-toolkit.test.js`
Expected: PASS — existing x-api-key behavior unchanged; new forwarding test passes.

- [ ] **Step 6: Commit**

```bash
git add mcp-server/lib/client.js app/api/mcp/route.js __tests__/unit/mcp-route.test.js
git commit -m "feat(oauth): forward caller credential (Bearer or x-api-key) through the MCP proxy"
```

---

### Task 10: Docs, SDK-doc checklist, full verification

**Files:**
- Modify: `mcp-server/README.md` (OAuth connector section)
- Modify: `docs/api-inventory` is regenerated by the pre-commit hook — do NOT hand-edit.

- [ ] **Step 1: Document the OAuth connector path**

Add to `mcp-server/README.md`, after the "Claude Desktop / Cowork (one-click .mcpb)" section from Leg 1:

```markdown
### Claude custom connector (remote, OAuth)

Self-hosted DashClaw is addable as a Claude **custom connector** with no API key
in the UI:

1. In Claude: Settings → Connectors → Add custom connector.
2. Paste `https://<your-instance>/api/mcp`.
3. Claude discovers `/.well-known/oauth-protected-resource`, registers via DCR,
   and opens your DashClaw login + a consent screen.
4. Authorize → the 23 governance tools appear, scoped to your workspace.

Works on Free/Pro/Max/Team/Enterprise (Free is capped at one custom connector).
The legacy `x-api-key` path (Managed Agents) is unchanged.
```

- [ ] **Step 2: Apply the migration on the running instance**

Run: `npm run db:migrate`
Expected: `oauth_*` tables present. (Per the repo gotcha, skipping this makes every authenticated request 401 after pulling schema changes.)

- [ ] **Step 3: Run the FULL suite (project rule — not targeted)**

Run: `npx vitest run`
Expected: PASS across the whole suite. No regressions in `middleware-*`, `mcp-*`, or elsewhere.

- [ ] **Step 4: Lint + build (app/** changed → build required)**

Run: `npm run lint`
Then: `npx next build`
Expected: both clean. Confirms the new `app/api/oauth/**` routes compile.

- [ ] **Step 5: Contract checks (route added → inventory/openapi)**

Run: `npm run route-sql:check` then `npm run api:inventory:check` and `npm run openapi:check`
Expected: pass. If `api:inventory:check` flags the new `/api/oauth/*` + `/api/mcp` changes, run `npm run api:inventory:generate` and `npm run openapi:generate`, then commit the regenerated `docs/api-inventory.*` + `docs/openapi/*`. (The pre-commit hook also regenerates these.)

- [ ] **Step 6: Manual end-to-end (cannot be unit-tested — needs Claude)**

1. Deploy (or run locally exposed over HTTPS via a tunnel).
2. Claude → Add custom connector → `https://<instance>/api/mcp`.
3. Confirm: redirected to DashClaw `/login`, then consent, then back to Claude.
4. Confirm `tools/list` shows 23 tools; run `dashclaw_guard`; confirm a decision returns and shows on `/decisions` under agent `claude-desktop`.
5. Wait past the 1-hour access TTL (or shorten `ACCESS_TTL_S` temporarily) and confirm refresh works without re-consent.

- [ ] **Step 7: Commit any regenerated artifacts**

```bash
git add mcp-server/README.md docs/api-inventory.json docs/api-inventory.md docs/openapi/critical-stable.openapi.json
git commit -m "docs(oauth): document the OAuth custom-connector flow + regen inventory"
```

---

## Self-Review

- **Spec coverage (Leg 2 of `2026-06-01-dashclaw-desktop-plugin-design.md`):** `.well-known` metadata → Task 4. DCR → Task 5. `/authorize` reusing NextAuth + consent → Task 6. `/token` PKCE + refresh → Task 7. `/api/mcp` 401+WWW-Authenticate + Bearer resolution + keep `x-api-key` → Task 8. Token↔workspace opaque DB-backed (locked decision #2) → Tasks 1,3. Credential forwarding so the proxy works under Bearer → Task 9. Read/write scopes advertised (`governance:read`/`governance:write`) → Task 4 metadata. Migration discipline (`db:migrate`) → Tasks 1,10. All covered. (Directory submission is explicitly deferred per locked decision #5 — no task, by design.)
- **Placeholder scan:** every code/SQL/test step is complete. Two steps are explicitly manual (Task 6 design-note consent polish is optional; Task 8 Step 1 and Task 10 Step 6 are flagged as needing the existing neon-mock wiring / a live Claude client — these are real constraints, not placeholders). The `makeRequest` `host`-header note in Task 4 instructs reading `__tests__/helpers.js` first to match its actual signature.
- **Type/name consistency:** `hashToken` (route, node hex) and `hashApiKey` (middleware, Web Crypto hex) produce the same digest for the same token — verified by the Task 2 `sha256Hex('abc')` vector. Token prefixes consistent: `oat_` (access), `ort_` (refresh), `oac_` (code), `ocl_` (client). Repository fn names (`registerClient`/`getClient`/`insertAuthCode`/`consumeAuthCode`/`insertAccessToken`/`resolveAccessToken`/`rotateRefreshToken`) match across Tasks 3, 5, 6, 7. `resolveOAuthToken`/`mcpAuthChallenge` match across Task 8. `issuerBase` exported from the AS metadata route and imported by the PR metadata route (Task 4). `authHeader`/`_authHeaders()` match across Task 9.
- **Security notes:** PKCE S256 mandatory (rejects `plain`); codes single-use via `UPDATE…RETURNING` guarded by `consumed_at IS NULL AND expires_at > NOW()`; `redirect_uri` validated against the registered client at both `/authorize` and `/token`; tokens stored only as SHA-256 hashes; access TTL 1h with refresh rotation (old refresh revoked on use).
```
