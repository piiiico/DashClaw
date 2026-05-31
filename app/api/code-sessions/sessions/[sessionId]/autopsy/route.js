export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db.js';
import { getOrgId } from '../../../../../lib/org.js';
import { getSessionDetail } from '../../../../../lib/repositories/code-sessions.repository.js';
import { buildAutopsyFromDetail } from '../../../../../lib/claude-code/goals.js';

export async function GET(request, { params }) {
  const { sessionId } = await params;
  const sql = getSql();
  const orgId = getOrgId(request);
  const detail = await getSessionDetail(sql, orgId, sessionId);
  if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(buildAutopsyFromDetail(detail));
}
