export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { computeRoi, SUBAGENT_NAMES } from '../../../lib/claude-code/subagent-roi.js';

export async function GET(request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id');
  const sql = getSql();
  const orgId = getOrgId(request);

  // Prefer action_records chains where present — higher fidelity than
  // JSONL re-derivation. Fall back to code_session_tool_uses for sessions
  // without governed actions.
  const rows = await sql`
    SELECT tu.name,
           COALESCE(ar.cost_estimate, 0) AS cost_usd,
           COALESCE(ar.duration_ms, 0) AS duration_ms,
           CASE WHEN ar.status = 'completed' THEN true
                WHEN ar.status = 'failed'    THEN false
                ELSE NULL END AS success
    FROM code_session_tool_uses tu
    JOIN code_sessions s ON s.id = tu.session_id
    LEFT JOIN action_records ar ON ar.action_id = tu.action_id AND ar.org_id = ${orgId}
    WHERE s.org_id = ${orgId}
      AND (${projectId}::text IS NULL OR s.project_id = ${projectId})
  `;
  const subagentNames = SUBAGENT_NAMES;
  const invocations = rows
    .filter(r => subagentNames.has(r.name))
    .map(r => ({
      name: r.name,
      cost_usd: Number(r.cost_usd) || 0,
      duration_ms: Number(r.duration_ms) || 0,
      success: r.success,
    }));
  return NextResponse.json({ project_id: projectId, roi: computeRoi(invocations) });
}
