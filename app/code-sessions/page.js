import Link from 'next/link';
import { headers } from 'next/headers';
import { getSql } from '../lib/db.js';
import { listProjects, countUnreadAlerts } from '../lib/repositories/code-sessions.repository.js';
import PageLayout from '../components/PageLayout';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CodeSessionsProjectsPage() {
  const h = await headers();
  const orgId = h.get('x-org-id') || 'org_default';
  const sql = getSql();
  const [projects, unread] = await Promise.all([
    listProjects(sql, orgId).catch(() => []),
    countUnreadAlerts(sql, orgId).catch(() => 0),
  ]);

  const subtitle = unread > 0
    ? `Claude Code session analytics (hooks + JSONL backfill) — ${unread} unread alert${unread === 1 ? '' : 's'}`
    : 'Claude Code session analytics (hooks + JSONL backfill)';

  return (
    <PageLayout title="Code Sessions" subtitle={subtitle} maturity="beta">
      {!projects.length ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-secondary">
          <p className="font-medium">No Code Sessions data yet.</p>
          <p className="mt-2 text-sm">
            Enable the Stop hook reporter (<code className="bg-surface-tertiary px-1 rounded">DASHCLAW_CODE_SESSIONS_ENABLED=1</code>),
            or backfill via <code className="bg-surface-tertiary px-1 rounded">dashclaw code ingest</code>.
          </p>
        </div>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border text-left text-tertiary">
              <th className="py-2 pr-3 font-medium">Project</th>
              <th className="py-2 pr-3 font-medium">Sessions</th>
              <th className="py-2 pr-3 font-medium">Total cost</th>
              <th className="py-2 pr-3 font-medium">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.id} className="border-b border-border last:border-0 hover:bg-surface-secondary/50">
                <td className="py-3 pr-3">
                  <Link className="font-medium text-orange-500 underline-offset-2 hover:underline"
                        href={`/code-sessions/${p.id}`}>
                    {p.slug}
                  </Link>
                  {p.cwd && <div className="mt-1 text-xs text-tertiary">{p.cwd}</div>}
                </td>
                <td className="py-3 pr-3 tabular-nums">{p.session_count}</td>
                <td className="py-3 pr-3 tabular-nums">${Number(p.total_cost_usd || 0).toFixed(2)}</td>
                <td className="py-3 pr-3 text-tertiary">
                  {p.last_session_at ? new Date(p.last_session_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PageLayout>
  );
}
