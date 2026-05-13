export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../../lib/db.js';
import { getOrgId } from '../../../../../../lib/org.js';
import {
  buildOptimalFilesBundle,
  planBundleSelections,
} from '../../../../../../lib/claude-code/optimal-files/bundle.js';
import {
  getSessionDetail,
  getProjectMedianCost,
  getSimilarSessionCount,
  saveManifest,
} from '../../../../../../lib/repositories/code-sessions.repository.js';

const ALLOWED_PREFIXES = ['CLAUDE.md', '.claude/agentlens/', '.claude/rules/', '.claude/hooks/', '.claude/skills/'];

function isAllowedPath(p) {
  if (!p) return false;
  if (p.startsWith('..') || p.includes('..\\') || p.includes('../')) return false;
  return ALLOWED_PREFIXES.some(pref => p === pref || p.startsWith(pref));
}

export async function POST(request, { params }) {
  const { sessionId } = await params;
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const selections = Array.isArray(body?.selections) ? body.selections : null;
  if (!selections) return NextResponse.json({ error: 'missing_selections' }, { status: 400 });

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

  // Validate every selected path is in the bundle and matches the allowlist.
  for (const sel of selections) {
    if (!sel?.path || !isAllowedPath(sel.path)) {
      return NextResponse.json({ error: 'invalid_path', path: sel?.path }, { status: 400 });
    }
    const inBundle = built.bundle.find(f => f.path === sel.path);
    if (!inBundle) return NextResponse.json({ error: 'path_not_in_bundle', path: sel.path }, { status: 400 });
  }

  const plan = planBundleSelections({
    bundle: built.bundle,
    projectCwd: session.project_cwd || '.',
    selections,
  });

  const saved = await saveManifest(sql, orgId, sessionId, session.project_cwd || '', plan.results, 24);
  return NextResponse.json({
    manifest_id: saved.id,
    expires_at: saved.expires_at,
    apply_command: `dashclaw code apply ${saved.id} --dest=${session.project_cwd || '<project-cwd>'}`,
  });
}
