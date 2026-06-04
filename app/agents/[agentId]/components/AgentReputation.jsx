'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Award, RotateCw, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Skeleton } from '../../../components/ui/Skeleton';
import { EmptyState } from '../../../components/ui/EmptyState';
import { StatCompact } from '../../../components/ui/Stat';
import { ProgressBar } from '../../../components/ui/ProgressBar';

// Scores are stored 0..1 (as numeric strings from Neon); coerce + scale to %.
const SCORE_TILES = [
  { key: 'reliability_score', label: 'Reliability' },
  { key: 'completion_rate', label: 'Completion' },
  { key: 'approval_adherence', label: 'Approval adherence' },
  { key: 'quality_score', label: 'Quality' },
];

function scorePct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(1, Math.max(0, n)) * 100);
}

function scoreColor(pct) {
  if (pct == null) return 'text-tertiary';
  if (pct >= 80) return 'text-success';
  if (pct >= 50) return 'text-warning';
  return 'text-error';
}

function barColor(pct) {
  if (pct == null) return 'brand';
  if (pct >= 80) return 'success';
  if (pct >= 50) return 'warning';
  return 'error';
}

function formatRelativeTime(isoString) {
  if (!isoString) return '—';
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const EVENT_VARIANT = {
  outcome: 'success',
  quality: 'info',
  approval: 'success',
  risk: 'warning',
  policy_violation: 'error',
};

export default function AgentReputation({ agentId }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [actionError, setActionError] = useState(null);

  const [events, setEvents] = useState([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [eventsError, setEventsError] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      const res = await fetch(`/api/reputation/agents/${encodeURIComponent(agentId)}/summary`);
      if (res.status === 404) {
        setSummary(null);
        setNotFound(true);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary || null);
      }
    } catch {
      /* leave previous state */
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (agentId) fetchSummary();
  }, [agentId, fetchSummary]);

  const recompute = useCallback(async () => {
    setRecomputing(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/reputation/agents/${encodeURIComponent(agentId)}/recompute`, { method: 'POST' });
      if (!res.ok) {
        setActionError('Recompute failed — try again.');
        return;
      }
      await fetchSummary();
    } catch {
      setActionError('Recompute failed — try again.');
    } finally {
      setRecomputing(false);
    }
  }, [agentId, fetchSummary]);

  const toggleEvents = useCallback(async () => {
    const next = !eventsOpen;
    setEventsOpen(next);
    if (next && !eventsLoaded) {
      setEventsError(false);
      try {
        const res = await fetch(`/api/reputation/agents/${encodeURIComponent(agentId)}/events`);
        if (res.ok) {
          const data = await res.json();
          setEvents(data.events || []);
        } else {
          setEventsError(true);
        }
      } catch {
        setEventsError(true);
      } finally {
        setEventsLoaded(true);
      }
    }
  }, [agentId, eventsOpen, eventsLoaded]);

  const recomputeButton = (
    <button
      onClick={recompute}
      disabled={recomputing}
      className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white disabled:opacity-50"
      aria-label="Recompute reputation"
    >
      <RotateCw size={14} className={recomputing ? 'animate-spin' : ''} aria-hidden="true" />
      {recomputing ? 'Recomputing…' : 'Recompute'}
    </button>
  );

  const totalEvents = Number(summary?.total_events) || 0;
  const confidencePct = scorePct(summary?.confidence);
  const isActive = Boolean(summary?.is_active);

  return (
    <div className="rounded-2xl border border-border bg-surface-secondary px-5 py-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Award size={14} className="text-tertiary" aria-hidden="true" />
          <span className="text-xs font-medium uppercase tracking-widest text-tertiary">Reputation</span>
          {summary && !loading && (
            <Badge variant={isActive ? 'success' : 'default'} size="xs">
              {isActive ? 'Active' : 'Dormant'}
            </Badge>
          )}
        </div>
        {recomputeButton}
      </div>

      {actionError && (
        <p className="mb-3 text-xs text-error" role="alert">{actionError}</p>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : notFound || !summary ? (
        <EmptyState
          icon={Award}
          title="No reputation computed yet"
          description="Run a recompute to derive a reliability vector from this agent's governed history."
          action={recomputeButton}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {SCORE_TILES.map(({ key, label }) => {
              const pct = scorePct(summary[key]);
              return (
                <div key={key} className="space-y-2">
                  <StatCompact
                    label={label}
                    value={pct == null ? '—' : `${pct}%`}
                    color={scoreColor(pct)}
                  />
                  <ProgressBar value={pct ?? 0} color={barColor(pct)} />
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <StatCompact label="Total events" value={totalEvents} />
            <div className="ml-auto flex items-center gap-3">
              <StatCompact
                label="Confidence"
                value={confidencePct == null ? '—' : `${confidencePct}%`}
                color={scoreColor(confidencePct)}
              />
            </div>
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <button
              onClick={toggleEvents}
              className="flex w-full items-center justify-between text-left text-xs font-medium text-secondary transition-colors hover:text-white"
              aria-expanded={eventsOpen}
            >
              <span>Reputation events</span>
              {eventsOpen ? <ChevronUp size={14} className="text-tertiary" /> : <ChevronDown size={14} className="text-tertiary" />}
            </button>
            {eventsOpen && (
              <div className="mt-3">
                {!eventsLoaded ? (
                  <Skeleton className="h-10 w-full rounded-lg" />
                ) : eventsError ? (
                  <p className="py-2 text-xs text-error" role="alert">Couldn&apos;t load reputation events.</p>
                ) : events.length === 0 ? (
                  <p className="py-2 text-xs text-tertiary">No reputation events recorded.</p>
                ) : (
                  <div className="divide-y divide-white/[0.04]">
                    {events.map((ev) => (
                      <div key={ev.id} className="flex items-center gap-3 py-2 text-xs">
                        <Badge variant={EVENT_VARIANT[ev.event_type] || 'default'} size="xs">
                          {ev.event_type}
                        </Badge>
                        <span className="font-mono text-secondary">{ev.event_type === 'risk' ? Number(ev.value) : Number(ev.value).toFixed(2)}</span>
                        <span className="ml-auto text-tertiary">{formatRelativeTime(ev.occurred_at || ev.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
