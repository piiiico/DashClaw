import Link from 'next/link';
import { headers } from 'next/headers';
import { getSql } from '../../lib/db.js';
import {
  listSessions,
  listSubagentToolUseAttribution,
  listMemos,
} from '../../lib/repositories/code-sessions.repository.js';
import { computeRoiFromRows } from '../../lib/claude-code/subagent-roi.js';
import PageLayout from '../../components/PageLayout';
import WeeklyMemoPanel from './WeeklyMemoPanel.jsx';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// keep/trim/drop verdict → chip tone. Status tokens only, label always paired
// with color so the verdict survives a WCAG / color-blind read.
const REC_META = {
  keep: { label: 'Keep', cls: 'text-status-success border-status-success/30 bg-status-success/10' },
  trim: { label: 'Trim', cls: 'text-status-warning border-status-warning/30 bg-status-warning/10' },
  drop: { label: 'Drop', cls: 'text-status-error border-status-error/30 bg-status-error/10' },
};

function RecChip({ recommendation }) {
  const meta = REC_META[recommendation]
    || { label: recommendation || '—', cls: 'text-tertiary border-border bg-surface-tertiary' };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function pct(rate) {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`;
}

function usd(n) {
  return n == null ? '—' : `$${Number(n).toFixed(2)}`;
}

export default async function ProjectSessionsPage({ params }) {
  const { projectId } = await params;
  const h = await headers();
  const orgId = h.get('x-org-id') || 'org_default';
  const sql = getSql();
  const [sessions, roiRows, memos] = await Promise.all([
    listSessions(sql, orgId, projectId, { limit: 100 }),
    // ROI + memo are best-effort retrospectives; a failure in either must not
    // blank the sessions list, so each degrades independently.
    listSubagentToolUseAttribution(sql, orgId, { projectId }).catch(() => []),
    listMemos(sql, orgId, projectId).catch(() => []),
  ]);
  const roi = computeRoiFromRows(roiRows);
  // listMemos returns rows ordered iso_week_tag DESC, so [0] is the latest.
  const latestMemo = memos[0] || null;

  return (
    <PageLayout
      title="Sessions"
      subtitle={`Project ${projectId}`}
      breadcrumbs={['Code Sessions', projectId]}
      maturity="beta"
    >
      {/* Weekly spend memo — server-seeded with the latest stored memo (Markdown
          body), with a client Regenerate action. Project-level summary, leads. */}
      <WeeklyMemoPanel projectId={projectId} initialMemo={latestMemo} />

      {/* Subagent ROI — keep/trim/drop per subagent by success rate and
          cost-per-success. Server-rendered via the same computeRoiFromRows the
          /subagent-roi API uses, so the verdict matches the API. Only shown
          when there's subagent activity to report. */}
      {roi.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-medium text-tertiary">Subagent ROI</h2>
          <p className="mb-3 text-xs text-tertiary">
            Keep / trim / drop by success rate and cost-per-success across this project&apos;s sessions.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-left text-tertiary">
                  <th className="py-2 pr-3 font-medium">Subagent</th>
                  <th className="py-2 pr-3 font-medium text-right">Runs</th>
                  <th className="py-2 pr-3 font-medium text-right">Total</th>
                  <th className="py-2 pr-3 font-medium text-right">Avg</th>
                  <th className="py-2 pr-3 font-medium text-right">Success</th>
                  <th className="py-2 pr-3 font-medium text-right">$/success</th>
                  <th className="py-2 pr-3 font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {roi.map(r => (
                  <tr key={r.name} className="border-b border-border last:border-0 hover:bg-surface-secondary/50">
                    <td className="py-3 pr-3 font-mono text-xs text-secondary">{r.name}</td>
                    <td className="py-3 pr-3 text-right tabular-nums">{r.invocation_count}</td>
                    <td className="py-3 pr-3 text-right tabular-nums">{usd(r.total_cost_usd)}</td>
                    <td className="py-3 pr-3 text-right tabular-nums">{usd(r.avg_cost_usd)}</td>
                    <td className="py-3 pr-3 text-right tabular-nums">{pct(r.success_rate)}</td>
                    <td className="py-3 pr-3 text-right tabular-nums">{usd(r.cost_per_success_usd)}</td>
                    <td className="py-3 pr-3"><RecChip recommendation={r.recommendation} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium text-tertiary">Sessions</h2>
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
      </section>
    </PageLayout>
  );
}
