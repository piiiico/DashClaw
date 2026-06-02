// __tests__/unit/oauth-metadata.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeRequest } from '../helpers.js';
import { GET as asGet } from '../../app/api/oauth/metadata/authorization-server/route.js';
import { GET as prGet } from '../../app/api/oauth/metadata/protected-resource/route.js';

describe('oauth metadata', () => {
  // issuerBase prefers DASHCLAW_URL then falls back to the request Host; clear the
  // override to force the host-derived branch for a deterministic assertion.
  beforeEach(() => vi.stubEnv('DASHCLAW_URL', ''));
  afterEach(() => vi.unstubAllEnvs());

  it('authorization-server metadata advertises S256 + endpoints', async () => {
    const res = await asGet(makeRequest('https://x.dashclaw.app/api/oauth/metadata/authorization-server', { headers: { host: 'x.dashclaw.app' } }));
    const m = await res.json();
    expect(m.issuer).toBe('https://x.dashclaw.app');
    expect(m.authorization_endpoint).toBe('https://x.dashclaw.app/api/oauth/authorize');
    expect(m.token_endpoint).toBe('https://x.dashclaw.app/api/oauth/token');
    expect(m.registration_endpoint).toBe('https://x.dashclaw.app/api/oauth/register');
    expect(m.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('protected-resource metadata points at /api/mcp and the AS', async () => {
    const res = await prGet(makeRequest('https://x.dashclaw.app/api/oauth/metadata/protected-resource', { headers: { host: 'x.dashclaw.app' } }));
    const m = await res.json();
    expect(m.resource).toBe('https://x.dashclaw.app/api/mcp');
    expect(m.authorization_servers).toEqual(['https://x.dashclaw.app']);
  });
});
