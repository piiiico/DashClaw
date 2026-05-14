'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useRealtime } from '../hooks/useRealtime';
import {
  Activity, Zap, Shield, Terminal,
  ChevronRight, AlertTriangle,
} from 'lucide-react';
import { getAgentColor } from '../lib/colors';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { groupEventsByDay, summarizeDay } from './dayGrouping';

// Re-export day-grouping helpers so consumers that previously imported
// from the page module continue to resolve.
export { groupEventsByDay, summarizeDay };

const categoryIconMap = {
  decision: Zap,
  guard: Shield,
  audit: Terminal,
  signal: AlertTriangle,
};

export default function GlobalActivityFeed() {
  const { agentId } = useAgentFilter();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');

  const fetchInitialData = useCallback(async () => {
    setLoading(true);
    try {
      // Pull recent data from multiple sources to seed the activity feed.
      // When an agent is selected, scope actions + guard evaluations to it.
      // activity_logs is keyed on the human actor_id, so it's skipped when
      // filtering by agent — there are no agent-scoped audit events yet.
      const agentQs = agentId ? `&agent_id=${encodeURIComponent(agentId)}` : '';
      const fetches = [
        fetch(`/api/actions?limit=15${agentQs}`),
        fetch(`/api/guard?limit=15${agentQs}`),
      ];
      if (!agentId) fetches.push(fetch('/api/activity?limit=10'));

      const [actionsRes, guardRes, auditRes] = await Promise.all(fetches);

      const actions = (await actionsRes.json()).actions || [];
      // /api/guard returns { decisions, total, stats } — the older
      // `.evaluations` key never existed on this endpoint, so reading it
      // silently produced [] on every page load and POLICY EVALUATION events
      // only survived in the live-stream buffer. On refresh they vanished
      // while the DECISION FINALIZED events (correctly read from `.actions`)
      // stuck around. Read the actual key the API returns.
      const guards = (await guardRes.json()).decisions || [];
      const audits = auditRes ? ((await auditRes.json()).logs || []) : [];

      // Normalize into unified event format
      const normalized = [
        ...actions.map(a => ({
          id: `act-${a.action_id}`,
          timestamp: a.timestamp_start,
          category: 'decision',
          label: a.status === 'completed' ? 'Decision finalized' : 'Intent declared',
          actor: a.agent_name || a.agent_id,
          actorId: a.agent_id,
          detail: a.declared_goal,
          status: a.status,
          link: `/decisions/${a.action_id}`
        })),
        ...guards.map(g => ({
          id: `grd-${g.id}`,
          timestamp: g.created_at,
          category: 'guard',
          label: 'Policy evaluation',
          actor: g.agent_name || g.agent_id,
          actorId: g.agent_id,
          detail: `${g.decision.toUpperCase()}: ${g.reason}`,
          status: g.decision,
          link: `/decisions` // Guard doesn't have deep detail yet
        })),
        ...audits.map(l => ({
          id: `aud-${l.id}`,
          timestamp: l.created_at,
          category: 'audit',
          label: 'System event',
          actor: l.actor_name || 'System',
          actorId: l.actor_id,
          detail: `${l.action.replace(/\./g, ' ')}`,
          status: 'info',
          link: `/audit-log`
        }))
      ];

      // Sort by time
      normalized.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setEvents(normalized.slice(0, 50));
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (error) {
      console.error('Failed to seed activity feed:', error);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  // Handle real-time updates. Drop events from other agents when filtering.
  useRealtime((event, payload) => {
    if (agentId && payload?.agent_id && payload.agent_id !== agentId) return;

    let newEvt = null;

    if (event === 'decision.created' || event === 'action.created') {
      newEvt = {
        id: `act-${payload.action_id}-${Date.now()}`,
        timestamp: payload.timestamp_start || new Date().toISOString(),
        category: 'decision',
        label: 'Intent declared',
        actor: payload.agent_name || payload.agent_id,
        actorId: payload.agent_id,
        detail: payload.declared_goal,
        status: 'running',
        link: `/decisions`
      };
    } else if (event === 'guard.decision.created') {
      newEvt = {
        id: `grd-${payload.id}-${Date.now()}`,
        timestamp: payload.created_at || new Date().toISOString(),
        category: 'guard',
        label: 'Policy evaluation',
        actor: payload.agent_name || payload.agent_id,
        actorId: payload.agent_id,
        detail: `${payload.decision.toUpperCase()}: ${payload.reason}`,
        status: payload.decision,
        link: `/decisions`
      };
    }

    if (newEvt) {
      setEvents(prev => [newEvt, ...prev].slice(0, 50));
      setLastUpdated(new Date().toLocaleTimeString());
    }
  });

  // D-13: client-side day-grouping. Presentational layer only — wraps the
  // existing per-event render with a one-line English summary per day.
  const groupedByDay = useMemo(() => groupEventsByDay(events), [events]);

  const getStatusColor = (category, status) => {
    if (category === 'guard') {
      if (status === 'block') return 'text-error bg-error-subtle border-error/30';
      if (status === 'warn') return 'text-warning bg-warning-subtle border-warning/30';
      if (status === 'require_approval') return 'text-info bg-info-subtle border-blue-500/30';
      return 'text-success bg-success-subtle border-success/30';
    }
    if (status === 'completed' || status === 'success') return 'text-success bg-success-subtle border-success/30';
    if (status === 'failed' || status === 'error') return 'text-error bg-error-subtle border-error/30';
    if (status === 'running' || status === 'pending') return 'text-warning bg-warning-subtle border-warning/30';
    return 'text-secondary bg-white/5 border-border';
  };

  const formatTime = (ts) => {
    try {
      const date = new Date(ts);
      return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return '--'; }
  };

  return (
    <PageLayout
      title="Activity stream"
      subtitle={`Real-time operational telemetry across decisions, governance, and system events${lastUpdated ? ` · Updated ${lastUpdated}` : ''}`}
      breadcrumbs={['Command', 'Activity']}
      maturity="beta"
    >
      <div className="mx-auto max-w-4xl">
        <Card hover={false}>
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-status-success" />
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary">Live feed</h2>
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] tabular-nums text-tertiary">
              Retention · 50 events
            </div>
          </div>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-4 p-6">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
              </div>
            ) : events.length === 0 ? (
              <div className="p-12">
                <EmptyState icon={Activity} title="No activity recorded" description="Waiting for agent actions or system events…" />
              </div>
            ) : (
              <div>
                {groupedByDay.map((group) => (
                  <section key={group.dayKey}>
                    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-tertiary/40 px-4 py-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary">
                        {group.label}
                      </span>
                      <span className="text-[11px] tabular-nums text-tertiary">
                        {summarizeDay(group)}
                      </span>
                    </header>
                    <div className="divide-y divide-border">
                      {group.events.map((evt) => {
                        const Icon = categoryIconMap[evt.category] || Activity;
                        return (
                          <div key={evt.id} className="group relative p-4 transition-colors hover:bg-white/[0.02]">
                            <div className="flex items-start gap-4">
                              {/* Time & Icon */}
                              <div className="flex min-w-[60px] flex-col items-center gap-2 pt-1">
                                <span className="font-mono text-[11px] tabular-nums text-tertiary">
                                  {formatTime(evt.timestamp)}
                                </span>
                                <div className="rounded-lg border border-border bg-surface-tertiary p-1.5 transition-colors group-hover:border-border-hover">
                                  <Icon size={14} className="text-secondary" aria-hidden="true" />
                                </div>
                              </div>

                              {/* Content */}
                              <div className="min-w-0 flex-1">
                                <div className="mb-1 flex flex-wrap items-center gap-2">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                                    {evt.label}
                                  </span>
                                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${getAgentColor(evt.actorId)}`}>
                                    {evt.actor}
                                  </span>
                                </div>
                                <div className="line-clamp-2 text-sm leading-relaxed text-secondary">
                                  {evt.detail}
                                </div>
                              </div>

                              {/* Status & Action */}
                              <div className="flex flex-col items-end gap-2 pt-1">
                                <div className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${getStatusColor(evt.category, evt.status)}`}>
                                  {evt.status}
                                </div>
                                {evt.link && (
                                  <a
                                    href={evt.link}
                                    className="flex items-center gap-0.5 text-[11px] font-medium text-secondary transition-colors hover:text-brand"
                                  >
                                    Details
                                    <ChevronRight size={11} aria-hidden="true" />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}

