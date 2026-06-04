export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db.js';
import { getOrgId } from '../../../../../lib/org.js';
import { createEndpoint, listEndpoints } from '../../../../../lib/repositories/x402.repository.js';

/** GET /api/x402/providers/:id/endpoints — list a provider's endpoints. */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const orgId = getOrgId(request);
    const sql = getSql();
    const endpoints = await listEndpoints(sql, orgId, id);
    return NextResponse.json({ endpoints });
  } catch (err) {
    console.error('[X402/PROVIDERS/:id/ENDPOINTS] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/x402/providers/:id/endpoints — add an endpoint to a provider. */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const orgId = getOrgId(request);
    const sql = getSql();
    const body = await request.json().catch(() => ({}));
    if (!body?.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const endpoint = await createEndpoint(sql, orgId, id, body);
    return NextResponse.json({ endpoint }, { status: 201 });
  } catch (err) {
    console.error('[X402/PROVIDERS/:id/ENDPOINTS] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
