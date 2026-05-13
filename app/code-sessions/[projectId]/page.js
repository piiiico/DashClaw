import Link from 'next/link';
import { headers } from 'next/headers';
import { getSql } from '../../lib/db.js';
import { listSessions } from '../../lib/repositories/code-sessions.repository.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ProjectSessionsPage({ params }) {
  const { projectId } = await params;
  const h = await headers();
  const orgId = h.get('x-org-id') || 'org_default';
  const sql = getSql();
  const sessions = await listSessions(sql, orgId, projectId, { limit: 100 });

  return (
    <div className="p-8">
      <header className="mb-6">
        <Link href="/code-sessions" className="text-sm text-zinc-500 underline">
          Code Sessions
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Sessions</h1>
        <p className="text-sm text-zinc-500">Project {projectId}</p>
      </header>

      {!sessions.length ? (
        <div className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-zinc-600">
          No sessions yet for this project.
        </div>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-zinc-500">
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
              <tr key={s.id} className="border-b last:border-0 hover:bg-zinc-50">
                <td className="py-3 pr-3 font-mono text-xs">
                  <Link className="text-orange-700 underline-offset-2 hover:underline"
                        href={`/code-sessions/${projectId}/${s.id}`}>
                    {String(s.session_uuid || '').slice(0, 8)}
                  </Link>
                </td>
                <td className="py-3 pr-3">
                  <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs">{s.source}</span>
                </td>
                <td className="py-3 pr-3 text-xs">{s.model_primary || '—'}</td>
                <td className="py-3 pr-3 tabular-nums">{s.message_count}</td>
                <td className="py-3 pr-3 tabular-nums">${Number(s.cost_usd || 0).toFixed(2)}</td>
                <td className="py-3 pr-3 text-zinc-500">
                  {s.started_at ? new Date(s.started_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
