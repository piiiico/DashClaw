export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db.js';
import { getOrgId } from '../../../../lib/org.js';
import {
  listProjects,
  saveMemo,
  getProjectSessionsChronological,
} from '../../../../lib/repositories/code-sessions.repository.js';
import { generateMemo } from '../../../../lib/claude-code/memo.js';

export async function POST(request) {
  const url = new URL(request.url);
  const projectIdent = url.searchParams.get('project_id') || url.searchParams.get('project');
  if (!projectIdent) return NextResponse.json({ error: 'missing_project' }, { status: 400 });
  const sql = getSql();
  const orgId = getOrgId(request);
  const projects = await listProjects(sql, orgId);
  const project = projects.find(p => p.id === projectIdent || p.slug === projectIdent);
  if (!project) return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  const all = await getProjectSessionsChronological(sql, orgId, project.id);
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const sessions = all.filter(s => s.started_at && s.started_at >= sevenDaysAgo);
  const priorSessions = all.filter(s => s.started_at && s.started_at >= fourteenDaysAgo && s.started_at < sevenDaysAgo);
  const memo = generateMemo({
    project: { id: project.id, slug: project.slug },
    sessions,
    priorSessions,
    findings: [],
    stuckLoopTotal: 0,
    now,
  });
  const saved = await saveMemo(sql, orgId, project.id, memo.weekTag, memo.markdown);
  return NextResponse.json({ memo: saved, summary: memo.summary });
}
