'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, Circle, CheckCircle, Play, PauseCircle,
  Flag, XCircle, AlertTriangle, RotateCw,
} from 'lucide-react';
import PageLayout from '../../components/PageLayout';
import { Card, CardContent } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';

function timeAgo(dateString) {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const statusBadge = {
  spawning: 'bg-zinc-500/20 text-secondary',
  ready: 'bg-info-subtle text-info',
  running: 'bg-success-subtle text-success',
  blocked: 'bg-warning-subtle text-warning',
  finished: 'bg-zinc-500/20 text-secondary',
  completed: 'bg-zinc-500/20 text-secondary',
  cancelled: 'bg-zinc-500/20 text-secondary',
  closed: 'bg-zinc-500/20 text-secondary',
  failed: 'bg-error-subtle text-error',
};

const eventIcons = {
  spawning: Circle,
  ready: CheckCircle,
  running: Play,
  blocked: PauseCircle,
  finished: Flag,
  completed: Flag,
  cancelled: Flag,
  closed: Flag,
  failed: XCircle,
};

const TERMINAL_STATUSES = ['finished', 'failed', 'closed', 'completed', 'cancelled'];

export default function SessionDetailPage() {
  const { sessionId } = useParams();
  const [session, setSession] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [patching, setPatching] = useState(false);
  const [actionError, setActionError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [sessionRes, eventsRes] = await Promise.all([
        fetch(`/api/sessions/${sessionId}`),
        fetch(`/api/sessions/${sessionId}/events`),
      ]);

      if (sessionRes.ok) {
        const sData = await sessionRes.json();
        setSession(sData.session || null);
      }
      if (eventsRes.ok) {
        const eData = await eventsRes.json();
        setEvents(eData.events || []);
      }
    } catch (error) {
      console.error('Failed to fetch session detail:', error);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Status controls — the PATCH route was unreachable from the UI, so a
  // blocked/stalled session could never be resolved or finished here. Honors
  // the closed-session 409 by surfacing the error instead of silently failing.
  const handlePatch = useCallback(async (updates) => {
    setPatching(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || 'Update failed');
        return;
      }
      if (data.session) setSession(data.session);
    } catch {
      setActionError('Update failed');
    } finally {
      setPatching(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <PageLayout
        title="Loading..."
        subtitle={sessionId}
        breadcrumbs={['Observe', 'Sessions', sessionId]}
      >
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </PageLayout>
    );
  }

  if (!session) {
    return (
      <PageLayout
        title="Session Not Found"
        subtitle={sessionId}
        breadcrumbs={['Observe', 'Sessions', sessionId]}
      >
        <div className="text-center py-12">
          <div className="text-sm text-secondary">This session does not exist or you don&apos;t have access.</div>
          <Link href="/sessions" className="inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand/80 transition-colors mt-4">
            <ArrowLeft size={14} /> Back to Sessions
          </Link>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={session.agent_id}
      subtitle={session.id}
      breadcrumbs={['Observe', 'Sessions', session.agent_id]}
      maturity="beta"
      actions={
        <div className="flex items-center gap-2">
          {session.status === 'blocked' && (
            <button
              onClick={() => handlePatch({ status: 'running' })}
              disabled={patching}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-success hover:text-success bg-success-subtle border border-success/20 rounded-lg disabled:opacity-50 transition-colors duration-150"
            >
              Clear block
            </button>
          )}
          {!TERMINAL_STATUSES.includes(session.status) && (
            <button
              onClick={() => handlePatch({ status: 'finished' })}
              disabled={patching}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-white bg-surface-tertiary border border-[rgba(255,255,255,0.06)] rounded-lg hover:border-[rgba(255,255,255,0.12)] disabled:opacity-50 transition-colors duration-150"
            >
              Mark finished
            </button>
          )}
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-white bg-surface-tertiary border border-[rgba(255,255,255,0.06)] rounded-lg hover:border-[rgba(255,255,255,0.12)] transition-colors duration-150"
          >
            <RotateCw size={14} />
            Refresh
          </button>
        </div>
      }
    >
      {/* Back link */}
      <div className="mb-6">
        <Link href="/sessions" className="inline-flex items-center gap-1.5 text-xs text-secondary hover:text-white transition-colors">
          <ArrowLeft size={14} /> Back to Sessions
        </Link>
      </div>

      {actionError && (
        <div role="alert" className="mb-4 px-4 py-2 rounded-lg bg-error-subtle border border-error/20 text-sm text-error">
          {actionError}
        </div>
      )}

      {/* Status + Meta */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <span className={`inline-flex items-center px-3 py-1 rounded-md text-sm font-medium capitalize ${statusBadge[session.status] || 'bg-zinc-500/20 text-secondary'}`}>
          {session.status}
        </span>
        {session.workspace && (
          <span className="text-xs text-secondary">
            <span className="text-disabled">Workspace:</span> {session.workspace}
          </span>
        )}
        {session.branch && (
          <span className="text-xs text-secondary">
            <span className="text-disabled">Branch:</span> {session.branch}
          </span>
        )}
      </div>

      {/* Blocked Alert */}
      {session.status === 'blocked' && session.blocked_reason && (
        <div className="mb-6 flex items-start gap-3 px-4 py-3 rounded-lg bg-warning-subtle border border-warning/20">
          <AlertTriangle size={16} className="text-warning mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-sm font-medium text-warning">Session Blocked</div>
            <div className="text-xs text-warning/80 mt-0.5">{session.blocked_reason}</div>
          </div>
        </div>
      )}

      {/* Info Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card hover={false}>
          <div className="p-4">
            <div className="text-[10px] uppercase tracking-widest text-tertiary mb-1">Green Level</div>
            <div className="text-sm font-medium text-white">{session.green_level || '-'}</div>
          </div>
        </Card>
        <Card hover={false}>
          <div className="p-4">
            <div className="text-[10px] uppercase tracking-widest text-tertiary mb-1">Branch Freshness</div>
            <div className="text-sm font-medium text-white">{session.branch_freshness || '-'}</div>
          </div>
        </Card>
        <Card hover={false}>
          <div className="p-4">
            <div className="text-[10px] uppercase tracking-widest text-tertiary mb-1">Commits Behind</div>
            <div className="text-sm font-medium text-white">{session.commits_behind != null ? session.commits_behind : '-'}</div>
          </div>
        </Card>
        <Card hover={false}>
          <div className="p-4">
            <div className="text-[10px] uppercase tracking-widest text-tertiary mb-1">Blocked Reason</div>
            <div className="text-sm font-medium text-white">{session.blocked_reason || '-'}</div>
          </div>
        </Card>
      </div>

      {/* Event Timeline */}
      <Card hover={false}>
        <div className="px-5 pt-5 pb-3">
          <span className="text-sm font-medium text-secondary uppercase tracking-wider">Event Timeline</span>
        </div>
        <CardContent className="p-0">
          {events.length === 0 ? (
            <div className="px-6 pb-6 text-xs text-tertiary">No events recorded yet.</div>
          ) : (
            <div className="px-6 pb-6">
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-white/5" />

                <div className="space-y-4">
                  {events.map((event) => {
                    const Icon = eventIcons[event.kind] || Circle;
                    return (
                      <div key={event.id || event.seq} className="flex items-start gap-3 relative">
                        <div className="relative z-10 flex-shrink-0 mt-0.5">
                          <Icon size={14} className={`${statusBadge[event.kind] ? statusBadge[event.kind].split(' ')[1] : 'text-secondary'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-secondary capitalize">{event.kind}</span>
                            <span className="text-[10px] text-disabled">{event.created_at ? timeAgo(event.created_at) : ''}</span>
                          </div>
                          {event.detail && (
                            <div className="text-xs text-tertiary mt-0.5">{event.detail}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </PageLayout>
  );
}
