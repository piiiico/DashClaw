// __tests__/unit/oauth-register.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../helpers.js';

const mockRegister = vi.fn();
vi.mock('../../app/lib/repositories/oauth.repository.js', () => ({ registerClient: mockRegister }));
vi.mock('../../app/lib/db.js', () => ({ getSql: () => vi.fn() }));

const { POST } = await import('../../app/api/oauth/register/route.js');

describe('POST /api/oauth/register', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects registration with no redirect_uris', async () => {
    const res = await POST(makeRequest('https://x/api/oauth/register', { headers: { host: 'x' }, body: { client_name: 'Claude' } }));
    expect(res.status).toBe(400);
  });

  it('registers a public client and returns a client_id', async () => {
    const res = await POST(makeRequest('https://x/api/oauth/register', {
      headers: { host: 'x' },
      body: { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] },
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.client_id).toMatch(/^ocl_/);
    expect(data.token_endpoint_auth_method).toBe('none');
    expect(mockRegister).toHaveBeenCalledOnce();
  });

  it('rejects non-https redirect URIs (open-redirect defense)', async () => {
    const res = await POST(makeRequest('https://x/api/oauth/register', {
      headers: { host: 'x' },
      body: { client_name: 'Evil', redirect_uris: ['http://evil.example/cb'] },
    }));
    expect(res.status).toBe(400);
    expect(mockRegister).not.toHaveBeenCalled();
  });
});
