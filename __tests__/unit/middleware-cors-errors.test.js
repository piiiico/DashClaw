import { describe, it, expect, vi, beforeEach } from 'vitest';

// Error rejections from middleware go through securedJson, which must apply the
// same CORS headers the success/public exit paths set. Otherwise a configured
// cross-origin browser client cannot read a 401/403/etc. (the browser blocks it
// as a CORS error). getCorsHeaders only emits Access-Control-Allow-Origin when
// ALLOWED_ORIGIN matches the request origin.
const sqlMock = vi.fn();
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn(() => sqlMock) }));

const { middleware } = await import('../../middleware.js');

function req(pathname, { headers = {}, method = 'GET' } = {}) {
  const url = `http://localhost:3000${pathname}`;
  return {
    url,
    method,
    nextUrl: new URL(url),
    headers: new Headers(headers),
    cookies: { get: () => undefined },
    ip: '127.0.0.1',
  };
}

describe('middleware applies CORS headers to error responses', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
    vi.stubEnv('DATABASE_URL', 'postgres://fake');
    vi.stubEnv('DASHCLAW_API_KEY', 'oc_live_sentinel_master_key_not_used');
    vi.stubEnv('ALLOWED_ORIGIN', 'https://app.example');
  });

  it('a 401 missing-key response carries Access-Control-Allow-Origin for the configured origin', async () => {
    // Protected route, no x-api-key, cross-origin (no sec-fetch-site) -> 401.
    const res = await middleware(req('/api/actions', { headers: { origin: 'https://app.example' } }));
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example');
  });

  it('does not emit the header for a non-allowlisted origin', async () => {
    const res = await middleware(req('/api/actions', { headers: { origin: 'https://evil.example' } }));
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
