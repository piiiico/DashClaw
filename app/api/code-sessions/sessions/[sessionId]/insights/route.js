export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db.js';
import { getOrgId } from '../../../../../lib/org.js';
import {
  getSessionInsights,
  listSignalsForSession,
} from '../../../../../lib/repositories/code-sessions.repository.js';
import { detectRepeatedRuns } from '../../../../../lib/claude-code/repeated-runs.js';

export async function GET(request, { params }) {
  const { sessionId } = await params;
  const sql = getSql();
  const orgId = getOrgId(request);
  const insights = await getSessionInsights(sql, orgId, sessionId);
  if (!insights) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const repeatedRuns = detectRepeatedRuns(insights.toolEvents);
  const signals = await listSignalsForSession(sql, orgId, sessionId);
  return NextResponse.json({
    session_id: sessionId,
    repeated_runs: repeatedRuns,
    signals,
  });
}
