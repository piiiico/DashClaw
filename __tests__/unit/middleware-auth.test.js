import { describe, it, expect, vi, beforeEach } from 'vitest';

// Coverage for the middleware API-key auth contract (the security surface):
// the DASHCLAW_API_KEY fast path, the api_keys slow path, readonly enforcement,
// cross-origin missing-key rejection, and public-route pass-through. neon is
// mocked so verifyOrgExists / resolveApiKey resolve deterministically.
const sqlMock = vi.fn();
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn(() => sqlMock) }));

const { middleware } = await import('../../middleware.js');

let keyCounter = 0;
const uniqueKey = () => `oc_live_auth_cov_${++keyCounter}`;

function req(pathname, { apiKey, method = 'GET', headers = {} } = {}) {
  const h = { ...headers };
  if (apiKey) h['x-api-key'] = apiKey;
  const url = `http://localhost:3000${pathname}`;
  return {
    url,
    method,
    nextUrl: new URL(url),
    headers: new Headers(h),
    cookies: { get: () => undefined },
    ip: '127.0.0.1',
  };
}

describe('middleware API-key auth', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
    vi.stubEnv('DATABASE_URL', 'postgres://fake');
    vi.stubEnv('DASHCLAW_API_KEY', 'oc_live_master_cov_key');
    vi.stubEnv('DASHCLAW_API_KEY_ORG', 'org_default');
  });

  it('fast path: the configured DASHCLAW_API_KEY is accepted when the org exists', async () => {
    sqlMock.mockResolvedValue([{ '1': 1 }]); // verifyOrgExists -> rows.length > 0
    const res = await middleware(req('/api/actions', { apiKey: 'oc_live_master_cov_key' }));
    expect(res.status).toBe(200);
  });

  it('fast path: 503 when the configured org does not exist (Neon-backed)', async () => {
    sqlMock.mockResolvedValue([]); // verifyOrgExists -> not found
    // A Neon URL bypasses the self-host bootstrap-trust early return, so the
    // existence query runs. Unique org so the 1h verifyOrgExists cache misses.
    vi.stubEnv('DATABASE_URL', 'postgres://ep-cov.neon.tech/db');
    vi.stubEnv('DASHCLAW_API_KEY_ORG', `org_missing_${++keyCounter}`);
    const res = await middleware(req('/api/actions', { apiKey: 'oc_live_master_cov_key' }));
    expect(res.status).toBe(503);
  });

  it('slow path: an unknown api key is rejected with 401', async () => {
    sqlMock.mockResolvedValue([]); // resolveApiKey -> no row
    const res = await middleware(req('/api/actions', { apiKey: uniqueKey() }));
    expect(res.status).toBe(401);
  });

  it('readonly key: a write method is forbidden with 403', async () => {
    sqlMock.mockResolvedValue([{ org_id: 'org_ro', role: 'readonly', revoked_at: null, hosted_mode: false }]);
    const res = await middleware(req('/api/actions', { apiKey: uniqueKey(), method: 'POST' }));
    expect(res.status).toBe(403);
  });

  it('readonly key: a GET is allowed', async () => {
    sqlMock.mockResolvedValue([{ org_id: 'org_ro', role: 'readonly', revoked_at: null, hosted_mode: false }]);
    const res = await middleware(req('/api/actions', { apiKey: uniqueKey(), method: 'GET' }));
    expect(res.status).toBe(200);
  });

  it('revoked key is rejected with 401', async () => {
    sqlMock.mockResolvedValue([{ org_id: 'org_x', role: 'admin', revoked_at: '2026-01-01T00:00:00Z', hosted_mode: false }]);
    const res = await middleware(req('/api/actions', { apiKey: uniqueKey() }));
    expect(res.status).toBe(401);
  });

  it('cross-origin request with no api key is rejected with 401', async () => {
    const res = await middleware(req('/api/actions', { headers: { origin: 'https://other.example' } }));
    expect(res.status).toBe(401);
  });

  it('public route is reachable without an api key', async () => {
    const res = await middleware(req('/api/health'));
    expect(res.status).toBe(200);
  });
});
