export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { computeRoi, SUBAGENT_NAMES } from '../../../lib/claude-code/subagent-roi.js';
import { listSubagentToolUseAttribution } from '../../../lib/repositories/code-sessions.repository.js';

export async function GET(request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id');
  const sql = getSql();
  const orgId = getOrgId(request);

  // Prefer action_records chains where present (higher fidelity than JSONL
  // re-derivation) and fall back to code_session_tool_uses for sessions
  // without governed actions. The raw SQL lives in the repository per the
  // route-level SQL guardrail.
  const rows = await listSubagentToolUseAttribution(sql, orgId, { projectId });
  const invocations = rows
    .filter(r => SUBAGENT_NAMES.has(r.name))
    .map(r => ({
      name: r.name,
      cost_usd: Number(r.cost_usd) || 0,
      duration_ms: Number(r.duration_ms) || 0,
      success: r.success,
    }));
  return NextResponse.json({ project_id: projectId, roi: computeRoi(invocations) });
}
