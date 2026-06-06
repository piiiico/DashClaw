export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db.js';
import { getOrgId } from '../../../../../lib/org.js';
import { apiErrorResponse } from '../../../../../lib/apiErrors.js';
import { deleteAccessRule } from '../../../../../lib/repositories/capability-access.repository.js';

export async function DELETE(request: Request, { params }: { params: Promise<{ capabilityId: string; ruleId: string }> }) {
  try {
    const { ruleId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);

    const result = await deleteAccessRule(sql, orgId, ruleId);
    if (!result) {
      return NextResponse.json({ error: 'rule_not_found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiErrorResponse(error, 'CAPABILITY_ACCESS_DELETE');
  }
}
