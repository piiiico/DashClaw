export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../../lib/db.js';
import { getOrgId } from '../../../../../../lib/org.js';
import {
  buildOptimalFilesBundle,
  previewBundleMerge,
} from '../../../../../../lib/claude-code/optimal-files/bundle.js';
import {
  getSessionDetail,
  getProjectMedianCost,
  getSimilarSessionCount,
} from '../../../../../../lib/repositories/code-sessions.repository.js';

export async function POST(request, { params }) {
  const { sessionId } = await params;
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const filePath = body?.path;
  if (!filePath) return NextResponse.json({ error: 'missing_path' }, { status: 400 });

  const sql = getSql();
  const orgId = getOrgId(request);
  const detail = await getSessionDetail(sql, orgId, sessionId);
  if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { session, toolUses } = detail;

  const [projectMedianCost, similarSessionCount] = await Promise.all([
    getProjectMedianCost(sql, orgId, session.project_id, sessionId),
    getSimilarSessionCount(sql, orgId, session.project_id, session),
  ]);
  const toolEvents = toolUses.map(t => ({ name: t.name, target: t.target, requestId: t.request_id }));
  const built = buildOptimalFilesBundle({
    session,
    project: { id: session.project_id, slug: session.project_slug, cwd: session.project_cwd },
    toolEvents,
    projectCwd: session.project_cwd,
    projectMedianCost,
    similarSessionCount,
    projectFiles: null,
    existingPaths: null,
  });

  // Server cannot read the user's disk — pass null existingContent so the CLI
  // gets a "no_existing_supplied" plan when it requests this endpoint and the
  // actual on-disk merge happens at apply-time.
  const result = previewBundleMerge({
    bundle: built.bundle,
    projectCwd: session.project_cwd || '.',
    filePath,
    existingContent: null,
  });
  return NextResponse.json(result);
}
