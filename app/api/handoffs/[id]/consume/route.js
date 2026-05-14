import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db.js';
import { getOrgId } from '../../../../lib/org.js';
import { apiErrorResponse } from '../../../../lib/apiErrors.js';
import { consumeHandoff } from '../../../../lib/repositories/code-session-handoffs.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const orgId = getOrgId(req);

    const body = await req.json().catch(() => ({}));
    const row = await consumeHandoff(sql, orgId, id, body.session_id || null);
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    return NextResponse.json({ id: row.id, consumed_at: row.consumed_at });
  } catch (err) {
    return apiErrorResponse(err, 'HANDOFFS_CONSUME');
  }
}
