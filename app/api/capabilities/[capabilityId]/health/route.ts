export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db.js';
import { getOrgId } from '../../../../lib/org.js';
import { apiErrorResponse } from '../../../../lib/apiErrors.js';
import { getCapability } from '../../../../lib/repositories/capabilities.repository.js';
import { getCapabilityWithHealth } from '../../../../lib/capability-health.js';

export async function GET(request: Request, { params }: { params: Promise<{ capabilityId: string }> }) {
  try {
    const { capabilityId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);

    const capability = await getCapability(sql, orgId, capabilityId);
    if (!capability) {
      return NextResponse.json({ error: 'Capability not found' }, { status: 404 });
    }

    const health = await getCapabilityWithHealth(sql, orgId, capability);
    return NextResponse.json(health);
  } catch (error) {
    return apiErrorResponse(error, 'CAPABILITY_HEALTH');
  }
}
