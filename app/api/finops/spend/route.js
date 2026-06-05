export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { getFleetSpend } from '../../../lib/repositories/finops.repository.js';

const ALLOWED_PERIODS = new Set(['7d', '30d', '90d']);

/** GET /api/finops/spend — Fleet-lens spend rollup (Agent Spend + x402). */
export async function GET(request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const raw = new URL(request.url).searchParams.get('period') || '30d';
    const period = ALLOWED_PERIODS.has(raw) ? raw : '30d';
    const data = await getFleetSpend(sql, orgId, { period });
    return NextResponse.json(data);
  } catch (err) {
    console.error('[FINOPS/SPEND] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
