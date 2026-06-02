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
