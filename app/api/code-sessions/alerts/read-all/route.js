export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db.js';
import { getOrgId } from '../../../../lib/org.js';
import { markAlertsRead } from '../../../../lib/repositories/code-sessions.repository.js';

export async function POST(request) {
  const sql = getSql();
  const orgId = getOrgId(request);
  let body = {};
  try { body = await request.json(); } catch { /* allow empty body */ }
  const ids = Array.isArray(body?.ids) ? body.ids.map(n => parseInt(n, 10)).filter(n => Number.isFinite(n)) : null;
  const updated = await markAlertsRead(sql, orgId, ids);
  return NextResponse.json({ marked: updated });
}
