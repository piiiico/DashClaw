import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockFetch = vi.fn();
global.fetch = mockFetch;
const { DashClaw } = await import('../../sdk/dashclaw.js');
function lastCall() {
  const [url, opts] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return { url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined };
}
describe('DashClaw — x402 SDK wrappers', () => {
  let claw;
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    claw = new DashClaw({ baseUrl: 'http://localhost:3000', apiKey: 'k', agentId: 'agent-1' });
  });
  it('listProviders GETs /api/x402/providers', async () => {
    await claw.listProviders({ status: 'active' });
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toContain('/api/x402/providers');
  });
  it('createProvider POSTs the body', async () => {
    await claw.createProvider({ name: 'Exa' });
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/x402/providers');
    expect(c.body).toEqual({ name: 'Exa' });
  });
  it('getProvider GETs the detail path', async () => {
    await claw.getProvider('prov_x');
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/x402/providers/prov_x');
  });
  it('updateProvider PATCHes the patch', async () => {
    await claw.updateProvider('prov_x', { status: 'disabled' });
    const c = lastCall();
    expect(c.method).toBe('PATCH');
    expect(c.body).toEqual({ status: 'disabled' });
  });
  it('createProviderEndpoint POSTs under the provider', async () => {
    await claw.createProviderEndpoint('prov_x', { name: 'Search' });
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/x402/providers/prov_x/endpoints');
    expect(c.body).toEqual({ name: 'Search' });
  });
  it('recordPurchase POSTs to /api/x402/purchases', async () => {
    await claw.recordPurchase({ agent_id: 'a1', provider: 'exa', declared_goal: 'r', purchase_reason: 'gap', context_gap: 'x', expected_value: 'y', cost_estimate: 0.05 });
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/x402/purchases');
    expect(c.body).toMatchObject({ provider: 'exa', cost_estimate: 0.05 });
  });
  it('listPurchases GETs /api/x402/purchases', async () => {
    await claw.listPurchases();
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toContain('/api/x402/purchases');
  });
});
