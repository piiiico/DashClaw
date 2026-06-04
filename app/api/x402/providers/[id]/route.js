export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db.js';
import { getOrgId } from '../../../../lib/org.js';
import { getProvider, updateProvider, listEndpoints } from '../../../../lib/repositories/x402.repository.js';

/** GET /api/x402/providers/:id — provider detail + its endpoints. */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const orgId = getOrgId(request);
    const sql = getSql();
    const provider = await getProvider(sql, orgId, id);
    if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    const endpoints = await listEndpoints(sql, orgId, id);
    return NextResponse.json({ provider, endpoints });
  } catch (err) {
    console.error('[X402/PROVIDERS/:id] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/x402/providers/:id — update a provider. */
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const orgId = getOrgId(request);
    const sql = getSql();
    const patch = await request.json().catch(() => ({}));
    const provider = await updateProvider(sql, orgId, id, patch);
    if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    return NextResponse.json({ provider });
  } catch (err) {
    console.error('[X402/PROVIDERS/:id] PATCH error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
