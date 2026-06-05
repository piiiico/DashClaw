import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ verifyJwt: vi.fn() }));
vi.mock('@/lib/jwks-verifier.js', () => ({
  verifyJwt: m.verifyJwt,
  extractBearerToken: (h) => {
    if (!h) return null;
    const match = h.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : null;
  },
}));

const { resolveAgentIdentity } = await import('@/lib/identity-resolution.js');

function reqWith(headers = {}) {
  return { headers: new Headers(headers) };
}

beforeEach(() => vi.clearAllMocks());

describe('resolveAgentIdentity (shared identity contract, R3)', () => {
  it('no bearer token → self-asserted identity, explicitly unverified', async () => {
    const id = await resolveAgentIdentity(reqWith(), { agentId: 'body_agent', agentName: 'Body' });
    expect(id.agent_id).toBe('body_agent');
    expect(id.verification_status).toBe('unverified');
    expect(id.verified).toBe(false);
    expect(m.verifyJwt).not.toHaveBeenCalled();
  });

  it('verified JWT overrides the body agent_id and marks verified', async () => {
    m.verifyJwt.mockResolvedValue({
      verification_status: 'verified', agent_id: 'jwt_sub', agent_name: 'JWT Agent', jti: 'j1', issuer: 'https://idp', exp: 9999999999,
    });
    const id = await resolveAgentIdentity(reqWith({ authorization: 'Bearer tok' }), { agentId: 'attacker_chosen', agentName: 'x' });
    expect(id.agent_id).toBe('jwt_sub');         // cryptographic proof beats self-assertion
    expect(id.agent_name).toBe('JWT Agent');
    expect(id.verification_status).toBe('verified');
    expect(id.verified).toBe(true);
  });

  it('failed/expired token does NOT grant verified privileges and keeps body identity', async () => {
    m.verifyJwt.mockResolvedValue({ verification_status: 'expired', agent_id: 'jwt_sub', agent_name: null, jti: null });
    const id = await resolveAgentIdentity(reqWith({ authorization: 'Bearer tok' }), { agentId: 'body_agent' });
    expect(id.agent_id).toBe('body_agent');      // untrusted token claims are NOT applied
    expect(id.verified).toBe(false);
    expect(id.verification_status).toBe('expired');
  });

  it('infra-unverified token (issuer down) falls back to self-asserted, never verified', async () => {
    m.verifyJwt.mockResolvedValue({ verification_status: 'unverified', agent_id: null, agent_name: null, jti: null });
    const id = await resolveAgentIdentity(reqWith({ authorization: 'Bearer tok' }), { agentId: 'body_agent' });
    expect(id.agent_id).toBe('body_agent');
    expect(id.verified).toBe(false);
    expect(id.verification_status).toBe('unverified');
  });
});
