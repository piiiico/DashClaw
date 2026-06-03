// __tests__/unit/oauth-repository.test.js
import { describe, it, expect, vi } from 'vitest';
import {
  registerClient, getClient, insertAuthCode, consumeAuthCode,
  insertAccessToken, resolveAccessToken, rotateRefreshToken, purgeExpired,
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

  it('registerClient and insertAuthCode and insertAccessToken issue an INSERT', async () => {
    const reg = makeSql([]);
    await registerClient(reg, { clientId: 'ocl_1', clientName: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback'], scope: null });
    expect(reg).toHaveBeenCalledOnce();

    const ins = makeSql([]);
    await insertAuthCode(ins, { codeHash: 'h', clientId: 'ocl_1', orgId: 'org_1', redirectUri: 'r', codeChallenge: 'c', expiresAt: 'e' });
    expect(ins).toHaveBeenCalledOnce();

    const tok = makeSql([]);
    await insertAccessToken(tok, { tokenHash: 'h', clientId: 'ocl_1', orgId: 'org_1', expiresAt: 'e' });
    expect(tok).toHaveBeenCalledOnce();
  });

  it('rotateRefreshToken returns null for an unknown/revoked refresh token', async () => {
    expect(await rotateRefreshToken(makeSql([]), 'gone')).toBeNull();
  });

  it('purgeExpired runs two DELETEs and returns per-table counts', async () => {
    // Each DELETE…RETURNING 1 resolves to the stub array (codes then tokens).
    const sql = makeSql([1, 1]);
    const result = await purgeExpired(sql);
    expect(sql).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ codes: 2, tokens: 2 });
  });
});
