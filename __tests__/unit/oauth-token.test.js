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

  it('rejects a client_id that does not match the code (OAuth 2.1 §4.1.3)', async () => {
    mockConsume.mockResolvedValue({
      client_id: 'ocl_1', org_id: 'org_1', redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: CHALLENGE, code_challenge_method: 'S256', scope: 'governance:write', agent_id: 'claude-desktop',
    });
    const res = await POST(form({
      grant_type: 'authorization_code', code: 'oac_abc', client_id: 'ocl_attacker',
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
