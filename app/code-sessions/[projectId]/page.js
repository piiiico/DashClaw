import Link from 'next/link';
import { headers } from 'next/headers';
import { getSql } from '../../lib/db.js';
import { listSessions } from '../../lib/repositories/code-sessions.repository.js';
import PageLayout from '../../components/PageLayout';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ProjectSessionsPage({ params }) {
  const { projectId } = await params;
  const h = await headers();
  const orgId = h.get('x-org-id') || 'org_default';
  const sql = getSql();
  const sessions = await listSessions(sql, orgId, projectId, { limit: 100 });

  return (
    <PageLayout
      title="Sessions"
      subtitle={`Project ${projectId}`}
      breadcrumbs={['Code Sessions', projectId]}
      maturity="beta"
    >
      {!sessions.length ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-secondary">
          No sessions yet for this project.
        </div>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border text-left text-tertiary">
              <th className="py-2 pr-3 font-medium">Session</th>
              <th className="py-2 pr-3 font-medium">Source</th>
              <th className="py-2 pr-3 font-medium">Model</th>
              <th className="py-2 pr-3 font-medium">Messages</th>
              <th className="py-2 pr-3 font-medium">Cost</th>
              <th className="py-2 pr-3 font-medium">Started</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s.id} className="border-b border-border last:border-0 hover:bg-surface-secondary/50">
                <td className="py-3 pr-3 font-mono text-xs">
                  <Link className="text-orange-500 underline-offset-2 hover:underline"
                        href={`/code-sessions/${projectId}/${s.id}`}>
                    {String(s.session_uuid || '').slice(0, 8)}
                  </Link>
                </td>
                <td className="py-3 pr-3">
                  <span className="rounded bg-surface-tertiary px-2 py-0.5 text-xs text-tertiary">{s.source}</span>
                </td>
                <td className="py-3 pr-3 text-xs">{s.model_primary || '—'}</td>
                <td className="py-3 pr-3 tabular-nums">{s.message_count}</td>
                <td className="py-3 pr-3 tabular-nums">${Number(s.cost_usd || 0).toFixed(2)}</td>
                <td className="py-3 pr-3 text-tertiary">
                  {s.started_at ? new Date(s.started_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PageLayout>
  );
}
