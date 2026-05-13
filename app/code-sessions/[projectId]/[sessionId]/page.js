import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getSql } from '../../../lib/db.js';
import {
  getSessionDetail,
  listSignalsForSession,
} from '../../../lib/repositories/code-sessions.repository.js';
import { estimateCost } from '../../../lib/billing.js';
import PageLayout from '../../../components/PageLayout';

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
  const signals = await listSignalsForSession(sql, orgId, sessionId).catch(() => []);

  // Mission Control reconciliation per A10: the Agent Spend tile folds
  // cache_read into tokens_in at 10% and prices through 2-column rates,
  // while session.cost_usd uses raw cache pricing. Surface both side-by-side.
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
    <PageLayout
      title="Session detail"
      subtitle={session.session_uuid}
      breadcrumbs={['Code Sessions', session.project_slug || projectId, String(session.session_uuid || '').slice(0, 8)]}
      maturity="beta"
    >
      <section className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium text-tertiary">Summary</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="inline text-tertiary">Model: </dt><dd className="inline">{session.model_primary || '—'}</dd></div>
            <div><dt className="inline text-tertiary">Messages: </dt><dd className="inline tabular-nums">{session.message_count}</dd></div>
            <div><dt className="inline text-tertiary">Source: </dt><dd className="inline">{session.source}</dd></div>
            <div className="border-t border-border pt-2 mt-2">
              <div className="font-medium">Cost reconciliation</div>
              <div className="text-xs text-tertiary mt-1">
                Code Sessions prices raw cache_read and cache_write separately;
                Mission Control folds cache_read at 10% into tokens_in. The two
                will differ slightly on cache-heavy sessions.
              </div>
              <div className="mt-2 tabular-nums text-xs">
                <div>Code Sessions: <strong>${Number(session.cost_usd || 0).toFixed(4)}</strong></div>
                <div>Mission Control: <strong>${missionControlCost.toFixed(4)}</strong></div>
              </div>
            </div>
            <div className={cacheLow ? 'text-orange-400' : ''}>
              Cache hit rate: <strong className="tabular-nums">{(cacheHit * 100).toFixed(1)}%</strong>
              {cacheLow && ' (below 30% floor)'}
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-border p-4 md:col-span-2">
          <h2 className="text-sm font-medium text-tertiary">Signals ({signals.length})</h2>
          {!signals.length ? (
            <p className="mt-3 text-sm text-tertiary">No signals for this session.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {signals.map(sig => (
                <li key={sig.id} className="border-l-2 border-border pl-3">
                  <div className="font-medium">{sig.kind}</div>
                  {sig.confidence && <div className="text-xs text-tertiary">confidence: {sig.confidence}</div>}
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
              <div key={m.id} className="border border-border rounded-md p-3">
                <div className="flex items-center gap-2 text-xs text-tertiary">
                  <span className="rounded bg-surface-tertiary px-2 py-0.5">{m.role}</span>
                  {m.model && <span>{m.model}</span>}
                  {m.timestamp && <span>{new Date(m.timestamp).toLocaleString()}</span>}
                  {m.cost_usd != null && (
                    <span className="tabular-nums">${Number(m.cost_usd).toFixed(4)}</span>
                  )}
                </div>
                {m.text_preview && (
                  <p className="mt-2 text-sm text-secondary line-clamp-3">{m.text_preview}</p>
                )}
                {toolsForMessage.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs">
                    {toolsForMessage.map(t => (
                      <li key={t.id} className="flex gap-2">
                        <span className="font-mono">{t.name}</span>
                        {t.target && <span className="text-tertiary truncate">{t.target}</span>}
                        {t.action_id && (
                          <Link href={`/replay/${t.action_id}`}
                             className="text-emerald-500 underline-offset-2 hover:underline">
                            governed
                          </Link>
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

      <div className="mt-6">
        <Link href={`/code-sessions/${projectId}`} className="text-sm text-tertiary underline">
          ← back to project sessions
        </Link>
      </div>
    </PageLayout>
  );
}
