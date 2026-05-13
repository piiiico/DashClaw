export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { listMemos, listProjects } from '../../../lib/repositories/code-sessions.repository.js';

export async function GET(request) {
  const url = new URL(request.url);
  const projectIdent = url.searchParams.get('project') || url.searchParams.get('project_id');
  if (!projectIdent) return NextResponse.json({ error: 'missing_project' }, { status: 400 });
  const sql = getSql();
  const orgId = getOrgId(request);
  // Accept project id or slug — resolve slug via listProjects if needed.
  let projectId = projectIdent;
  if (!projectIdent.startsWith('cp_')) {
    const projects = await listProjects(sql, orgId);
    const match = projects.find(p => p.slug === projectIdent);
    if (!match) return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
    projectId = match.id;
  }
  const memos = await listMemos(sql, orgId, projectId);
  return NextResponse.json({ memos });
}
