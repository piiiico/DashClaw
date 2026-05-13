export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { listProjects } from '../../../lib/repositories/code-sessions.repository.js';

export async function GET(request) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const projects = await listProjects(sql, orgId);
  return NextResponse.json({ projects });
}
