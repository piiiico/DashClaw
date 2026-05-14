import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db.js';
import { getOrgId } from '../../lib/org.js';
import { apiErrorResponse } from '../../lib/apiErrors.js';
import { createHandoff } from '../../lib/repositories/code-session-handoffs.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req) {
  try {
    const sql = getSql();
    const orgId = getOrgId(req);

    const body = await req.json().catch(() => ({}));
    if (!body.agent_id) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
    if (!body.bundle || typeof body.bundle !== 'object') {
      return NextResponse.json({ error: 'bundle (object) required' }, { status: 400 });
    }

    const result = await createHandoff(sql, orgId, {
      agentId: body.agent_id,
      projectId: body.project_id || null,
      createdInSessionId: body.created_in_session_id || null,
      bundle: body.bundle,
    });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err, 'HANDOFFS_POST');
  }
}
