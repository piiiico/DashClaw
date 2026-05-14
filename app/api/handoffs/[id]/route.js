import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { getHandoffById } from '../../../lib/repositories/code-session-handoffs.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const orgId = await getOrgId(req);
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const row = await getHandoffById(sql, orgId, id);
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    return NextResponse.json({
      id: row.id,
      agent_id: row.agent_id,
      project_id: row.project_id,
      bundle: row.bundle_json,
      created_at: row.created_at,
      consumed_at: row.consumed_at,
    });
  } catch (err) {
    console.error('[HANDOFF GET] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
