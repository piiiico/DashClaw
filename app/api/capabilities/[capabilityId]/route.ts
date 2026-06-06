export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { apiErrorResponse } from '../../../lib/apiErrors.js';
import {
  getCapability,
  updateCapability,
  deleteCapability,
} from '../../../lib/repositories/capabilities.repository.js';

export async function GET(request: Request, { params }: { params: Promise<{ capabilityId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { capabilityId } = await params;

    const capability = await getCapability(sql, orgId, capabilityId);
    if (!capability) {
      return NextResponse.json({ error: 'Capability not found' }, { status: 404 });
    }
    return NextResponse.json({ capability });
  } catch (error) {
    return apiErrorResponse(error, 'CAPABILITY GET');
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ capabilityId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { capabilityId } = await params;
    const body = await request.json();

    try {
      const updated = await updateCapability(sql, orgId, capabilityId, body);
      if (!updated) {
        return NextResponse.json({ error: 'Capability not found' }, { status: 404 });
      }
      return NextResponse.json({ capability: updated });
    } catch (validationError) {
      const message = (validationError as Error).message;
      if (
        message?.startsWith('risk_level') ||
        message?.startsWith('source_type')
      ) {
        return NextResponse.json({ error: message }, { status: 400 });
      }
      throw validationError;
    }
  } catch (error) {
    return apiErrorResponse(error, 'CAPABILITY PATCH');
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ capabilityId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { capabilityId } = await params;

    const deleted = await deleteCapability(sql, orgId, capabilityId);
    if (!deleted) {
      return NextResponse.json({ error: 'Capability not found' }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiErrorResponse(error, 'CAPABILITY DELETE');
  }
}
