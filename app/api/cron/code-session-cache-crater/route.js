export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { timingSafeCompare } from '../../../lib/timing-safe.js';
import { detectCacheCrater } from '../../../lib/claude-code/alerts.js';
import { insertAlerts } from '../../../lib/repositories/code-sessions.repository.js';

function isoWeekStart(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

export async function GET(request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
    }
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !timingSafeCompare(authHeader, `Bearer ${cronSecret}`)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sql = getSql();
    const summary = { projects_scanned: 0, alerts_inserted: 0 };

    const now = new Date();
    const thisWeekStart = isoWeekStart(now).toISOString();
    const priorWeekStart = new Date(isoWeekStart(now).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const nextWeekStart = new Date(isoWeekStart(now).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const projects = await sql`
      SELECT p.id AS project_id, p.org_id, p.slug
      FROM code_projects p
      WHERE EXISTS (SELECT 1 FROM code_sessions s WHERE s.project_id = p.id)
    `;

    for (const proj of projects) {
      summary.projects_scanned += 1;
      const thisWeekRows = await sql`
        SELECT
          COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
          COALESCE(SUM(cache_read_tokens), 0)::bigint AS cache_read_tokens,
          COALESCE(SUM(cache_creation_tokens), 0)::bigint AS cache_creation_tokens
        FROM code_sessions
        WHERE project_id = ${proj.project_id}
          AND started_at >= ${thisWeekStart}
          AND started_at < ${nextWeekStart}
      `;
      const priorWeekRows = await sql`
        SELECT
          COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
          COALESCE(SUM(cache_read_tokens), 0)::bigint AS cache_read_tokens,
          COALESCE(SUM(cache_creation_tokens), 0)::bigint AS cache_creation_tokens
        FROM code_sessions
        WHERE project_id = ${proj.project_id}
          AND started_at >= ${priorWeekStart}
          AND started_at < ${thisWeekStart}
      `;
      const thisWeek = {
        input_tokens: Number(thisWeekRows[0]?.input_tokens) || 0,
        cache_read_tokens: Number(thisWeekRows[0]?.cache_read_tokens) || 0,
        cache_creation_tokens: Number(thisWeekRows[0]?.cache_creation_tokens) || 0,
      };
      const priorWeek = {
        input_tokens: Number(priorWeekRows[0]?.input_tokens) || 0,
        cache_read_tokens: Number(priorWeekRows[0]?.cache_read_tokens) || 0,
        cache_creation_tokens: Number(priorWeekRows[0]?.cache_creation_tokens) || 0,
      };
      const alert = detectCacheCrater({ thisWeek, priorWeek, project: proj });
      if (!alert) continue;
      const inserted = await insertAlerts(sql, proj.org_id, [{ ...alert, scope: 'project' }], {
        project_id: proj.project_id,
      });
      summary.alerts_inserted += inserted;
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error('[cron/code-session-cache-crater] Error:', err);
    return NextResponse.json({ error: 'Cache-crater sweep failed' }, { status: 500 });
  }
}
