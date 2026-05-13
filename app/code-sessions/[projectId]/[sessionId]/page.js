import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getSql } from '../../../lib/db.js';
import {
  getSessionDetail,
  listSignalsForSession,
} from '../../../lib/repositories/code-sessions.repository.js';
import { estimateCost } from '../../../lib/billing.js';
import { labelFor, severityRank } from '../../../lib/claude-code/signal-labels.js';
import PageLayout from '../../../components/PageLayout';
import OptimalFilesPanel from './OptimalFilesPanel.jsx';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TIMELINE_DEFAULT_CAP = 50;

export default async function CodeSessionDetailPage({ params }) {
  const { projectId, sessionId } = await params;
  const h = await headers();
  const orgId = h.get('x-org-id') || 'org_default';
  const sql = getSql();

  const detail = await getSessionDetail(sql, orgId, sessionId);
  if (!detail) notFound();
  const { session, messages, toolUses } = detail;
  const signals = await listSignalsForSession(sql, orgId, sessionId).catch(() => []);

  // Mission Control reconciliation per A10: Agent Spend folds cache_read into
  // tokens_in at 10% and prices through the 2-column billing table; session
  // cost uses raw 4-column pricing. They should agree within ~5% for most
  // sessions; a >2x spread is a real divergence worth flagging.
  const foldedCacheTokensIn =
    (session.input_tokens || 0)
    + (session.cache_creation_tokens || 0)
    + Math.round((session.cache_read_tokens || 0) * 0.1);
  const missionControlCost = estimateCost(
    foldedCacheTokensIn,
    session.output_tokens || 0,
    session.model_primary,
  );
  const codeSessionsCost = Number(session.cost_usd || 0);
  const costRatio = codeSessionsCost > 0
    ? Math.max(missionControlCost, codeSessionsCost) / Math.min(missionControlCost, codeSessionsCost)
    : 0;
  const costDiverges = codeSessionsCost > 0 && costRatio >= 2;

  const cacheTotal = (session.input_tokens || 0)
                   + (session.cache_creation_tokens || 0)
                   + (session.cache_read_tokens || 0);
  const cacheHit = cacheTotal > 0 ? (session.cache_read_tokens || 0) / cacheTotal : 0;
  const cacheLow = cacheHit < 0.3;

  // Group repeated_run signals into one cluster summary so the panel doesn't
  // get overrun by N near-identical rows. The original payload is preserved
  // for the cluster detail.
  const namedSignals = [];
  const repeatedRuns = [];
  for (const sig of signals) {
    if (sig.kind === 'repeated_run') repeatedRuns.push(sig);
    else namedSignals.push(sig);
  }
  namedSignals.sort((a, b) => severityRank(b) - severityRank(a));

  const repeatedSummary = (() => {
    if (!repeatedRuns.length) return null;
    const byConfidence = { high: 0, medium: 0, low: 0 };
    const targetCounts = new Map();
    for (const r of repeatedRuns) {
      byConfidence[r.confidence] = (byConfidence[r.confidence] || 0) + 1;
      const name = r.payload?.name || 'tool';
      const count = r.payload?.count || 1;
      targetCounts.set(name, (targetCounts.get(name) || 0) + count);
    }
    const topTargets = [...targetCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    return { total: repeatedRuns.length, byConfidence, topTargets };
  })();

  // Filter chips for timeline. Server-rendered so it stays zero-JS — chips
  // are <Link>s carrying a `?filter=` query param consumed below.
  const filter = '';
  const totalMessages = messages.length;
  const filteredMessages = messages;
  const overCap = filteredMessages.length > TIMELINE_DEFAULT_CAP;
  const visibleMessages = filteredMessages.slice(0, TIMELINE_DEFAULT_CAP);
  const hiddenMessages = filteredMessages.slice(TIMELINE_DEFAULT_CAP);

  function renderMessage(m) {
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
          {toolsForMessage.length > 0 && (
            <span className="rounded bg-surface-tertiary px-1.5 py-0.5 text-[10px]">
              {toolsForMessage.length} tool{toolsForMessage.length === 1 ? '' : 's'}
            </span>
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
  }

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
                should agree within ~5% on normal sessions.
              </div>
              <div className="mt-2 tabular-nums text-xs">
                <div>Code Sessions: <strong>${codeSessionsCost.toFixed(4)}</strong></div>
                <div>Mission Control: <strong>${missionControlCost.toFixed(4)}</strong></div>
              </div>
              {costDiverges && (
                <div className="mt-2 rounded border border-orange-400/40 bg-orange-400/10 p-2 text-xs text-orange-300">
                  ⚠ {costRatio.toFixed(1)}× divergence — beyond the 5% expected gap.
                  Likely either: (a) model lacks cache rates in <code>app/lib/billing.js</code>,
                  (b) cache_read fold heuristic is off for this model, or
                  (c) token totals differ between parser and stored values.
                </div>
              )}
            </div>
            <div className={cacheLow ? 'text-orange-400' : ''}>
              Cache hit rate: <strong className="tabular-nums">{(cacheHit * 100).toFixed(1)}%</strong>
              {cacheLow && ' (below 30% floor)'}
            </div>
          </dl>
          <div className="mt-4 border-t border-border pt-3">
            <OptimalFilesPanel sessionId={sessionId} />
          </div>
        </div>

        <div className="rounded-lg border border-border p-4 md:col-span-2">
          <h2 className="text-sm font-medium text-tertiary">
            Signals ({namedSignals.length}{repeatedSummary ? ` + ${repeatedSummary.total} repeats` : ''})
          </h2>
          {!signals.length ? (
            <p className="mt-3 text-sm text-tertiary">No signals for this session.</p>
          ) : (
            <ul className="mt-3 space-y-3 text-sm">
              {namedSignals.map(sig => {
                const meta = labelFor(sig.kind);
                const title = sig.payload?.title;
                const description = sig.payload?.description;
                return (
                  <li key={sig.id} className="border-l-2 border-border pl-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{meta.label}</span>
                      {sig.confidence && (
                        <span className="rounded bg-surface-tertiary px-1.5 py-0.5 text-[10px] text-tertiary uppercase">
                          {sig.confidence}
                        </span>
                      )}
                      {sig.savings_usd != null && Number(sig.savings_usd) > 0 && (
                        <span className="text-xs text-emerald-400 tabular-nums">
                          ≈ ${Number(sig.savings_usd).toFixed(2)} savings
                        </span>
                      )}
                    </div>
                    {title && <div className="mt-1 text-xs text-secondary">{title}</div>}
                    {description && (
                      <div className="mt-1 text-xs text-tertiary">{description}</div>
                    )}
                    {meta.suggestion && (
                      <div className="mt-1 text-xs text-tertiary italic">
                        → {meta.suggestion}
                      </div>
                    )}
                  </li>
                );
              })}
              {repeatedSummary && (
                <li className="border-l-2 border-border pl-3">
                  <details>
                    <summary className="cursor-pointer">
                      <span className="font-medium">Repeated tool runs</span>
                      <span className="ml-2 text-xs text-tertiary">
                        {repeatedSummary.total} total — {repeatedSummary.byConfidence.high || 0} high,
                        {' '}{repeatedSummary.byConfidence.medium || 0} medium,
                        {' '}{repeatedSummary.byConfidence.low || 0} low
                      </span>
                    </summary>
                    <div className="mt-2 text-xs text-tertiary">
                      Top tools by call count:
                      <ul className="mt-1 ml-4 list-disc">
                        {repeatedSummary.topTargets.map(([name, count]) => (
                          <li key={name}><span className="font-mono">{name}</span> ×{count}</li>
                        ))}
                      </ul>
                      <p className="mt-2 italic">→ {labelFor('repeated_run').suggestion}</p>
                    </div>
                  </details>
                </li>
              )}
            </ul>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Timeline</h2>
          <span className="text-xs text-tertiary">{totalMessages} message{totalMessages === 1 ? '' : 's'}</span>
        </div>
        <div className="space-y-3">
          {visibleMessages.map(renderMessage)}
          {overCap && (
            <details className="rounded-md border border-dashed border-border p-3">
              <summary className="cursor-pointer text-sm text-tertiary">
                Show remaining {hiddenMessages.length} message{hiddenMessages.length === 1 ? '' : 's'}
              </summary>
              <div className="mt-3 space-y-3">
                {hiddenMessages.map(renderMessage)}
              </div>
            </details>
          )}
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
