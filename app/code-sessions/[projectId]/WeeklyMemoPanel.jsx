'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RotateCcw, TrendingUp, TrendingDown, Minus } from 'lucide-react';

// Weekly spend memo. The server loads the latest stored memo and seeds this
// island via `initialMemo`; the Regenerate button rebuilds it from the last
// 7 days. Display is server-visible (no JS needed to read it) — only the
// regenerate action is interactive.

function usd(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function DeltaBadge({ deltaUsd, pctChange }) {
  // Cost moving is informational, not an incident — keep it calm (no alarm
  // colors). Direction is carried by icon + text, never color alone (WCAG).
  if (pctChange == null) {
    return <span className="text-xs text-tertiary">no prior week to compare</span>;
  }
  const flat = Math.abs(pctChange) < 0.05;
  const Icon = flat ? Minus : pctChange > 0 ? TrendingUp : TrendingDown;
  const dir = flat ? 'flat' : pctChange > 0 ? 'up' : 'down';
  const magnitude = flat ? '' : ` ${Math.abs(pctChange * 100).toFixed(0)}%`;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-tertiary">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span>{dir}{magnitude} vs last week</span>
      <span className="tabular-nums">({deltaUsd >= 0 ? '+' : '−'}{usd(Math.abs(deltaUsd))})</span>
    </span>
  );
}

function MemoBody({ memo, projectId }) {
  const ts = memo.stored_at || memo.generated_at;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums text-primary">
          {usd(memo.this_week_cost_usd)}
        </span>
        <DeltaBadge deltaUsd={memo.delta_usd} pctChange={memo.pct_change} />
      </div>

      <p className="text-sm text-secondary">{memo.headline}</p>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
        <div className="flex justify-between gap-3 border-t border-border pt-2">
          <dt className="text-tertiary">Last week</dt>
          <dd className="tabular-nums text-secondary">{usd(memo.last_week_cost_usd)}</dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-border pt-2">
          <dt className="text-tertiary">Busiest day</dt>
          <dd className="tabular-nums text-secondary">
            {memo.busiest_day
              ? `${memo.busiest_day.day} · ${usd(memo.busiest_day.total)}`
              : '—'}
          </dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-border pt-2 sm:col-span-2">
          <dt className="text-tertiary">Most expensive session</dt>
          <dd className="tabular-nums">
            {memo.top_session ? (
              <Link
                href={`/code-sessions/${projectId}/${memo.top_session.id}`}
                className="text-orange-500 underline-offset-2 hover:underline"
              >
                {String(memo.top_session.session_uuid || memo.top_session.id).slice(0, 8)} · {usd(memo.top_session.cost_usd)}
              </Link>
            ) : (
              <span className="text-secondary">—</span>
            )}
          </dd>
        </div>
      </dl>

      {ts && (
        <p className="text-[11px] text-tertiary">
          Generated {new Date(ts).toLocaleString()}
        </p>
      )}
    </div>
  );
}

export default function WeeklyMemoPanel({ projectId, initialMemo = null }) {
  const [memo, setMemo] = useState(initialMemo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function regenerate() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(
        `/api/code-sessions/memos/regenerate?project=${encodeURIComponent(projectId)}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Regenerate failed (HTTP ${res.status}). ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      setMemo(data.memo || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-8">
      <div className="rounded-lg border border-border bg-surface-secondary/30 p-5">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-primary">Weekly memo</h2>
            <p className="mt-0.5 text-sm text-tertiary">
              Trailing 7 days vs the prior 7, for this project.
            </p>
          </div>
          <button
            type="button"
            onClick={regenerate}
            disabled={busy}
            className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:border-border-hover hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Regenerate weekly memo"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden />
            {busy ? 'Regenerating…' : 'Regenerate'}
          </button>
        </header>

        {error && (
          <div className="mb-3 rounded-md border border-status-error/30 bg-status-error/5 p-3 text-sm text-status-error" role="alert">
            {error}
          </div>
        )}

        {memo ? (
          <MemoBody memo={memo} projectId={projectId} />
        ) : (
          <div className="flex flex-col items-start gap-3 py-2">
            <p className="text-sm text-tertiary">
              No memo yet for this project. Generate one from the last 7 days of sessions.
            </p>
            <button
              type="button"
              onClick={regenerate}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Generating…' : 'Generate memo'}
              {!busy && <ArrowRight className="h-4 w-4" aria-hidden />}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
