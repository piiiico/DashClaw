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
