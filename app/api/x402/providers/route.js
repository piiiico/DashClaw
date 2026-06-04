export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { createProvider, listProviders } from '../../../lib/repositories/x402.repository.js';

/** GET /api/x402/providers — list providers (org-scoped). */
export async function GET(request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const status = new URL(request.url).searchParams.get('status') || undefined;
    const providers = await listProviders(sql, orgId, { status });
    return NextResponse.json({ providers });
  } catch (err) {
    console.error('[X402/PROVIDERS] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/x402/providers — register a paid x402 provider. */
export async function POST(request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const body = await request.json().catch(() => ({}));
    if (!body?.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const provider = await createProvider(sql, orgId, body);
    return NextResponse.json({ provider }, { status: 201 });
  } catch (err) {
    console.error('[X402/PROVIDERS] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
