'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';

const decisionVariant = {
  block: 'error',
  require_approval: 'warning',
  warn: 'info',
  allow: 'success',
};

const decisionDot = {
  block: 'bg-status-error',
  require_approval: 'bg-status-warning',
  warn: 'bg-status-info',
  allow: 'bg-status-success',
};

// JWT-integrity audit axis (verification / replay / action-binding). Most calls
// sit at the benign defaults (unverified / not_applicable / ok), so only the
// noteworthy states are badged to keep the feed readable.
function integrityBadges(d) {
  const out = [];
  const v = d.verification_status;
  if (v && v !== 'unverified' && v !== 'not_applicable') {
    out.push({ label: v === 'verified' ? 'verified' : `verify: ${v}`, variant: v === 'verified' ? 'success' : 'error' });
  }
  if (d.replay_status && d.replay_status !== 'not_applicable' && d.replay_status !== 'ok') {
    out.push({ label: `replay: ${d.replay_status}`, variant: 'error' });
  }
  if (d.act_status && d.act_status !== 'not_applicable' && d.act_status !== 'ok') {
    out.push({ label: `act: ${d.act_status}`, variant: 'error' });
  }
  return out;
}

function formatRelativeTime(isoString) {
  if (!isoString) return '\u2014';
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ActivityTab() {
  const [decisions, setDecisions] = useState([]);
  const [stats, setStats] = useState({ blocks: 0, approvals: 0, warns: 0 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterDecision, setFilterDecision] = useState('');
  const [offset, setOffset] = useState(0);

  const fetchDecisions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      params.set('offset', offset.toString());
      if (filterDecision) params.set('decision', filterDecision);
      const res = await fetch(`/api/guard/decisions?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (offset === 0) {
          setDecisions(data.decisions || []);
        } else {
          setDecisions(prev => [...prev, ...(data.decisions || [])]);
        }
        setTotal(data.total || 0);
        if (data.stats) setStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to fetch guard decisions:', err);
    } finally {
      setLoading(false);
    }
  }, [filterDecision, offset]);

  useEffect(() => { setOffset(0); }, [filterDecision]);
  useEffect(() => { fetchDecisions(); }, [fetchDecisions]);

  return (
    <div className="space-y-4">
      {/* Stats strip — prose rail */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary">
        <span><span className="font-semibold tabular-nums text-error">{stats.blocks}</span> blocks (7d)</span>
        <span aria-hidden="true" className="text-zinc-700">&middot;</span>
        <span><span className="font-semibold tabular-nums text-warning">{stats.approvals}</span> approvals (7d)</span>
        <span aria-hidden="true" className="text-zinc-700">&middot;</span>
        <span><span className="font-semibold tabular-nums text-info">{stats.warns}</span> warns (7d)</span>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <label htmlFor="decision-filter" className="sr-only">
          Filter decisions
        </label>
        <select
          id="decision-filter"
          value={filterDecision}
          onChange={e => setFilterDecision(e.target.value)}
          className="rounded-lg border border-border bg-surface-tertiary px-2.5 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          <option value="">All decisions</option>
          <option value="block">Blocked</option>
          <option value="require_approval">Require approval</option>
          <option value="warn">Warn</option>
          <option value="allow">Allowed</option>
        </select>
      </div>

      {/* Feed */}
      <div className="rounded-xl border border-border bg-surface-secondary">
        {loading && decisions.length === 0 ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : decisions.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-tertiary">No guard decisions yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {decisions.map(d => (
              <div key={d.id} className="px-5 py-4">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${decisionDot[d.decision] || 'bg-zinc-500'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={decisionVariant[d.decision] || 'default'} size="xs">{d.decision}</Badge>
                      <span className="text-xs text-secondary">{d.action_type}</span>
                      <span aria-hidden="true" className="text-xs text-zinc-700">&middot;</span>
                      <span className="text-xs text-secondary">{d.agent_name || d.agent_id || 'unknown'}</span>
                      <span aria-hidden="true" className="text-xs text-zinc-700">&middot;</span>
                      <span className="text-xs tabular-nums text-tertiary">{formatRelativeTime(d.created_at)}</span>
                      {integrityBadges(d).map((b, i) => (
                        <Badge key={i} variant={b.variant} size="xs">{b.label}</Badge>
                      ))}
                    </div>
                    {d.matched_policies?.length > 0 && (
                      <div className="mt-1 text-xs text-tertiary">
                        Policy: <span className="text-secondary">{d.matched_policies.join(', ')}</span>
                      </div>
                    )}
                    {d.risk_score != null && (
                      <div className="mt-0.5 text-xs text-tertiary">
                        Risk: <span className={`tabular-nums font-semibold ${d.risk_score >= 70 ? 'text-error' : d.risk_score >= 30 ? 'text-warning' : 'text-secondary'}`}>{d.risk_score}</span>
                      </div>
                    )}
                    {d.declared_goal && (
                      <div className="mt-1 truncate text-xs text-secondary">{d.declared_goal}</div>
                    )}
                    {d.reason && (
                      <div className="mt-0.5 text-xs text-tertiary">{d.reason}</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {decisions.length < total && (
          <div className="border-t border-border px-5 py-3 text-center">
            <button
              onClick={() => setOffset(decisions.length)}
              disabled={loading}
              className="text-xs text-brand transition-colors hover:text-brand-hover disabled:opacity-50"
            >
              {loading ? 'Loading…' : `Load more (${decisions.length} of ${total})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
