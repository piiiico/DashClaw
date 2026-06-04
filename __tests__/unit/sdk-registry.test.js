import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { DashClaw } = await import('../../sdk/dashclaw.js');

function lastCall() {
  const [url, opts] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return { url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined };
}

describe('DashClaw — Agent Registry SDK wrappers (C4)', () => {
  let claw;
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    claw = new DashClaw({ baseUrl: 'http://localhost:3000', apiKey: 'k', agentId: 'agent-1' });
  });

  it('registerAgent POSTs to /api/agents/registry', async () => {
    await claw.registerAgent({ name: 'Pricing API', risk_class: 'high' });
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/agents/registry');
    expect(c.body).toEqual({ name: 'Pricing API', risk_class: 'high' });
  });

  it('listRegisteredAgents GETs the registry with filters', async () => {
    await claw.listRegisteredAgents({ status: 'active' });
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/agents/registry?status=active');
  });

  it('getRegisteredAgent / updateRegisteredAgent hit the [id] route', async () => {
    await claw.getRegisteredAgent('reg_1');
    expect(lastCall().url).toBe('http://localhost:3000/api/agents/registry/reg_1');
    await claw.updateRegisteredAgent('reg_1', { status: 'disabled' });
    const c = lastCall();
    expect(c.method).toBe('PATCH');
    expect(c.body).toEqual({ status: 'disabled' });
  });

  it('addAgentCapability / listAgentCapabilities hit the capabilities sub-resource', async () => {
    await claw.addAgentCapability('reg_1', 'cap_9');
    let c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/agents/registry/reg_1/capabilities');
    expect(c.body).toEqual({ capability_id: 'cap_9' });
    await claw.listAgentCapabilities('reg_1');
    expect(lastCall().method).toBe('GET');
  });

  it('invokeRegisteredAgent POSTs the delegation body to /api/agents/invoke', async () => {
    await claw.invokeRegisteredAgent({ registered_agent_id: 'reg_1', capability_id: 'cap_9', agent_id: 'a', payload: { q: 1 } });
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/agents/invoke');
    expect(c.body).toMatchObject({ registered_agent_id: 'reg_1', capability_id: 'cap_9', agent_id: 'a', payload: { q: 1 } });
  });
});
