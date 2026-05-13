import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getSql } from '../../../lib/db.js';
import {
  getSessionDetail,
  listSignalsForSession,
} from '../../../lib/repositories/code-sessions.repository.js';
import { estimateCost } from '../../../lib/billing.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CodeSessionDetailPage({ params }) {
  const { projectId, sessionId } = await params;
  const h = await headers();
  const orgId = h.get('x-org-id') || 'org_default';
  const sql = getSql();

  const detail = await getSessionDetail(sql, orgId, sessionId);
  if (!detail) notFound();
  const { session, messages, toolUses } = detail;
  const signals = await listSignalsForSession(sql, orgId, sessionId);

  // Mission Control reconciliation per A10: compute a parallel cost using the
  // legacy 4-arg estimateCost so the user can see the difference between
  // the cache-aware total (session.cost_usd) and the folded-cache attribution
  // that Mission Control's Agent Spend tile uses.
  const foldedCacheTokensIn =
    (session.input_tokens || 0)
    + (session.cache_creation_tokens || 0)
    + Math.round((session.cache_read_tokens || 0) * 0.1);
  const missionControlCost = estimateCost(
    foldedCacheTokensIn,
    session.output_tokens || 0,
    session.model_primary,
  );

  const cacheTotal = (session.input_tokens || 0)
                   + (session.cache_creation_tokens || 0)
                   + (session.cache_read_tokens || 0);
  const cacheHit = cacheTotal > 0 ? (session.cache_read_tokens || 0) / cacheTotal : 0;
  const cacheLow = cacheHit < 0.3;

  return (
    <div className="p-8">
      <nav className="mb-4 text-sm text-zinc-500">
        <Link href="/code-sessions" className="underline">Code Sessions</Link>
        {' / '}
        <Link href={`/code-sessions/${projectId}`} className="underline">{session.project_slug}</Link>
        {' / '}
        <span className="font-mono text-xs">{String(session.session_uuid || '').slice(0, 8)}</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-bold">Session detail</h1>
        <p className="text-xs font-mono text-zinc-500">{session.session_uuid}</p>
      </header>

      <section className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="rounded-lg border p-4">
          <h2 className="text-sm font-medium text-zinc-500">Summary</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="inline text-zinc-500">Model: </dt><dd className="inline">{session.model_primary || '—'}</dd></div>
            <div><dt className="inline text-zinc-500">Messages: </dt><dd className="inline tabular-nums">{session.message_count}</dd></div>
            <div><dt className="inline text-zinc-500">Source: </dt><dd className="inline">{session.source}</dd></div>
            <div className="border-t pt-2 mt-2">
              <div className="font-medium">Cost reconciliation</div>
              <div className="text-xs text-zinc-500 mt-1">
                Code Sessions prices raw cache_read and cache_write separately;
                Mission Control folds cache_read at 10% into tokens_in. The two
                will differ slightly on cache-heavy sessions.
              </div>
              <div className="mt-2 tabular-nums">
                <div>Code Sessions: <strong>${Number(session.cost_usd || 0).toFixed(4)}</strong> (raw cache pricing)</div>
                <div>Mission Control attribution: <strong>${missionControlCost.toFixed(4)}</strong></div>
              </div>
            </div>
            <div className={cacheLow ? 'text-amber-700' : ''}>
              Cache hit rate: <strong className="tabular-nums">{(cacheHit * 100).toFixed(1)}%</strong>
              {cacheLow && ' (below 30% floor)'}
            </div>
          </dl>
        </div>

        <div className="rounded-lg border p-4 md:col-span-2">
          <h2 className="text-sm font-medium text-zinc-500">Signals ({signals.length})</h2>
          {!signals.length ? (
            <p className="mt-3 text-sm text-zinc-500">No signals for this session.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {signals.map(sig => (
                <li key={sig.id} className="border-l-2 border-zinc-300 pl-3">
                  <div className="font-medium">{sig.kind}</div>
                  {sig.confidence && <div className="text-xs text-zinc-500">confidence: {sig.confidence}</div>}
                  {sig.savings_usd != null && Number(sig.savings_usd) > 0 && (
                    <div className="text-xs">est. savings: ${Number(sig.savings_usd).toFixed(2)}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">Timeline</h2>
        <div className="space-y-3">
          {messages.map(m => {
            const toolsForMessage = toolUses.filter(t => t.message_id === m.id);
            return (
              <div key={m.id} className="border rounded-md p-3">
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="rounded bg-zinc-100 px-2 py-0.5">{m.role}</span>
                  {m.model && <span>{m.model}</span>}
                  {m.timestamp && <span>{new Date(m.timestamp).toLocaleString()}</span>}
                  {m.cost_usd != null && (
                    <span className="tabular-nums">${Number(m.cost_usd).toFixed(4)}</span>
                  )}
                </div>
                {m.text_preview && (
                  <p className="mt-2 text-sm text-zinc-700 line-clamp-3">{m.text_preview}</p>
                )}
                {toolsForMessage.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs">
                    {toolsForMessage.map(t => (
                      <li key={t.id} className="flex gap-2">
                        <span className="font-mono">{t.name}</span>
                        {t.target && <span className="text-zinc-500 truncate">{t.target}</span>}
                        {t.action_id && (
                          <a href={`/replay/${t.action_id}`}
                             className="text-emerald-700 underline-offset-2 hover:underline">
                            governed
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
