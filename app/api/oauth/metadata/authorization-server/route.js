// app/api/oauth/metadata/authorization-server/route.js
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export function issuerBase(request) {
  if (process.env.DASHCLAW_URL) return process.env.DASHCLAW_URL.replace(/\/$/, '');
  // Use the request Host — the stable public domain the client actually connected
  // through — and mirror mcpAuthChallenge() so discovery, the WWW-Authenticate
  // challenge, and these metadata docs all agree on one issuer.
  // DO NOT substitute process.env.VERCEL_URL here: that is the per-deployment URL
  // (e.g. my-dashclaw-<hash>.vercel.app), which sits behind Vercel deployment
  // protection AND mismatches the resource identifier the client is using — both
  // break Claude's DCR ("Couldn't register…"). Host-header injection on a
  // misconfigured self-host proxy is mitigated by setting DASHCLAW_URL explicitly.
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
