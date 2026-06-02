// __tests__/unit/mcp-client-auth.test.js
// Verifies DashClawClient forwards the caller credential: a Bearer Authorization
// (OAuth connector path) takes precedence over x-api-key, and x-api-key is used
// when no authHeader is set. Lives in its own file because mcp-route.test.js
// vi.mock()s the client module, which would shadow the real implementation.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DashClawClient } from '../../mcp-server/lib/client.js';

afterEach(() => vi.restoreAllMocks());

describe('DashClawClient auth header forwarding', () => {
  it('forwards Authorization: Bearer and omits x-api-key when authHeader is set', async () => {
    const c = new DashClawClient({ url: 'http://localhost:3000', authHeader: 'Bearer oat_x' });
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
    await c.post('/api/guard', {});
    const [, opts] = spy.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer oat_x');
    expect(opts.headers['x-api-key']).toBeUndefined();
  });

  it('falls back to x-api-key when no authHeader is set', async () => {
    const c = new DashClawClient({ url: 'http://localhost:3000', apiKey: 'oc_live_x' });
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
    await c.get('/api/policies', {});
    const [, opts] = spy.mock.calls[0];
    expect(opts.headers['x-api-key']).toBe('oc_live_x');
    expect(opts.headers.Authorization).toBeUndefined();
  });
});
