// app/api/oauth/metadata/authorization-server/route.js
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export function issuerBase(request) {
  if (process.env.DASHCLAW_URL) return process.env.DASHCLAW_URL.replace(/\/$/, '');
  // VERCEL_URL is the platform-set deployment host (not client-controllable), so
  // prefer it over the request Host header to keep OAuth discovery from being
  // poisoned by host-header injection behind a misconfigured self-host proxy.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const host = request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}

export async function GET(request) {
  const base = issuerBase(request);
  return NextResponse.json({
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['governance:read', 'governance:write'],
  });
}
