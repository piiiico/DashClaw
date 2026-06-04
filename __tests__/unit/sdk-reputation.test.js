import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { DashClaw } = await import('../../sdk/dashclaw.js');

function lastCall() {
  const [url, opts] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return { url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers };
}

describe('DashClaw — Agent Reputation SDK wrappers (B5)', () => {
  let claw;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    claw = new DashClaw({ baseUrl: 'http://localhost:3000', apiKey: 'k', agentId: 'agent-1' });
  });

  it('getAgentReputation GETs the agent vector', async () => {
    await claw.getAgentReputation('agent_9');
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/reputation/agents/agent_9');
    expect(c.body).toBeUndefined();
    expect(c.headers['x-api-key']).toBe('k');
  });

  it('listAgentReputationEvents passes pagination as query params', async () => {
    await claw.listAgentReputationEvents('agent_9', { limit: 10, offset: 20 });
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/reputation/agents/agent_9/events?limit=10&offset=20');
    expect(c.body).toBeUndefined();
  });

  it('recomputeAgentReputation POSTs to the recompute sub-resource (no body)', async () => {
    await claw.recomputeAgentReputation('agent_9');
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/reputation/agents/agent_9/recompute');
  });

  it('getAgentReputationReceipt GETs the receipt sub-resource', async () => {
    await claw.getAgentReputationReceipt('agent_9');
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/reputation/agents/agent_9/receipt');
  });

  it('verifyReputationReceipt POSTs the receipt to the verify route', async () => {
    await claw.verifyReputationReceipt({ vectorHash: 'sha256:abc', signature: { alg: 'EdDSA' } });
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/reputation/verify');
    expect(c.body).toEqual({ receipt: { vectorHash: 'sha256:abc', signature: { alg: 'EdDSA' } } });
  });
});
