export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../../lib/db.js';
import { getOrgId } from '../../../../../../lib/org.js';
import { apiErrorResponse } from '../../../../../../lib/apiErrors.js';
import { getWorkflowRun } from '../../../../../../lib/repositories/workflow-runs.repository.js';

export async function GET(request: Request, { params }: { params: Promise<{ templateId: string; runActionId: string }> }) {
  try {
    const { templateId, runActionId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);

    const run = await getWorkflowRun(sql, orgId, runActionId);

    if (!run) {
      return NextResponse.json(
        { error: 'run_not_found' },
        { status: 404 },
      );
    }

    return NextResponse.json(run);
  } catch (error) {
    return apiErrorResponse(error, 'WORKFLOW_RUN_DETAIL');
  }
}
