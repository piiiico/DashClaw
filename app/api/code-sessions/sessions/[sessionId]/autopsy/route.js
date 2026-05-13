export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db.js';
import { getOrgId } from '../../../../../lib/org.js';
import { getSessionDetail } from '../../../../../lib/repositories/code-sessions.repository.js';
import { detectRepeatedRuns } from '../../../../../lib/claude-code/repeated-runs.js';
import { buildAutopsy } from '../../../../../lib/claude-code/goals.js';

export async function GET(request, { params }) {
  const { sessionId } = await params;
  const sql = getSql();
  const orgId = getOrgId(request);
  const detail = await getSessionDetail(sql, orgId, sessionId);
  if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { session, messages, toolUses } = detail;
  const userTurns = messages.filter(m => m.role === 'user').map(m => m.text_preview || '');
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  const summaryCues = /\b(done|completed|shipped|pass(?:ed|ing)?|ready|stopping|all tests|complete)\b/i;
  const hasFinalSummary = !!(lastAssistant?.text_preview && summaryCues.test(lastAssistant.text_preview));
  const toolEvents = toolUses.map(t => ({ name: t.name, requestId: t.request_id, target: t.target }));
  const stuckLoops = detectRepeatedRuns(toolEvents).filter(r => r.confidence === 'high');
  const autopsy = buildAutopsy({ session, userTurns, stuckLoops, toolEvents, hasFinalSummary });
  return NextResponse.json(autopsy);
}
