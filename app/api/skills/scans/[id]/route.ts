import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db.js';
import { getOrgId } from '../../../../lib/org.js';
import { apiErrorResponse } from '../../../../lib/apiErrors.js';
import { getScanById } from '../../../../lib/repositories/skill-scan-results.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const orgId = getOrgId(req);

    const row = await getScanById(sql, orgId, id);
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    return apiErrorResponse(err, 'SCAN_GET');
  }
}
