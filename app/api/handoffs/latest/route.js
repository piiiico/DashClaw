import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { getLatestHandoff } from '../../../lib/repositories/code-session-handoffs.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req) {
  try {
    const sql = getSql();
    const orgId = await getOrgId(req);
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agent_id');
    const projectId = searchParams.get('project_id');
    if (!agentId) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });

    const row = await getLatestHandoff(sql, orgId, { agentId, projectId });
    if (!row) return NextResponse.json({ error: 'no_handoff' }, { status: 404 });

    return NextResponse.json({
      id: row.id,
      agent_id: row.agent_id,
      project_id: row.project_id,
      bundle: row.bundle_json,
      created_at: row.created_at,
    });
  } catch (err) {
    console.error('[HANDOFFS LATEST] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
