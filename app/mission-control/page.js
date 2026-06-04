'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Activity, ShieldCheck, ArrowRight, TrendingUp, TrendingDown,
  Users, Clock, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useRealtime } from '../hooks/useRealtime';
import { getAgentColor } from '../lib/colors';
import QuickStart from '../components/QuickStart';
import OperationsFeed from './components/OperationsFeed.jsx';
import RuntimeSummaryCard from './components/RuntimeSummaryCard.jsx';
import AgentSpendCard from '../components/AgentSpendCard';
import MissionControlCapabilityHealthCard from '../components/MissionControlCapabilityHealthCard';
import { isDemoMode } from '../lib/isDemoMode';
import { computePosture } from '../components/SystemStatusBar';

/* ---------- Helpers ---------- */

function formatRelativeTime(ts) {
  if (!ts) return '--';
  const diffMs = Date.now() - new Date(ts).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function truncateText(text, maxLen) {
  if (!text) return '';
  return text.length > maxLen ? text.substring(0, maxLen) + '\u2026' : text;
}

/* ---------- Intervention merging ---------- */

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function buildInterventionList(pendingActions, openLoops) {
  const items = [];

  for (const action of pendingActions) {
    items.push({
      id: `approval:${action.action_id}`,
      kind: 'approval',
      agentId: action.agent_id,
      agentName: action.agent_name || action.agent_id,
      description: action.declared_goal || action.action_type || 'Pending action',
      href: '/approvals',
      sortKey: -1,
    });
  }

  for (const loop of openLoops) {
    const isRelevant = loop.loop_type === 'approval' || loop.priority === 'critical' || loop.priority === 'high';
    if (!isRelevant) continue;
    items.push({
      id: `loop:${loop.loop_id}`,
      kind: 'loop',
      agentId: loop.agent_id,
      agentName: loop.agent_name || loop.agent_id,
      description: loop.description || loop.loop_type || 'Open loop',
      href: '/dashboard',
      sortKey: PRIORITY_ORDER[loop.priority] ?? 2,
    });
  }

  items.sort((a, b) => a.sortKey - b.sortKey);
  return items;
}

/* ---------- Skeleton placeholders ---------- */

function CommandStripSkeleton() {
  return (
    <div className="mb-6 rounded-xl border border-border bg-surface-tertiary px-5 py-3">
      <div className="flex items-center gap-6">
        {[120, 80, 70, 100, 90].map((w, i) => (
          <div key={i} className="h-5 animate-pulse rounded bg-white/5" style={{ width: w }} />
        ))}
      </div>
    </div>
  );
}

function InterventionSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-3 w-28 animate-pulse rounded bg-white/5" />
      <div className="h-8 w-12 animate-pulse rounded bg-white/5" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="h-4 w-16 animate-pulse rounded bg-white/5" />
          <div className="h-4 w-14 animate-pulse rounded bg-white/5" />
          <div className="h-4 flex-1 animate-pulse rounded bg-white/5" />
        </div>
      ))}
    </div>
  );
}

function MetricSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-3 w-20 animate-pulse rounded bg-white/5" />
      <div className="h-8 w-16 animate-pulse rounded bg-white/5" />
      <div className="h-3 w-24 animate-pulse rounded bg-white/5" />
    </div>
  );
}

/* ---------- Main page ---------- */

export default function MissionControlPage() {
  const { agentId, agents } = useAgentFilter();
  const [signals, setSignals] = useState(null);
  const [loops, setLoops] = useState(null);
  const [health, setHealth] = useState(null);
  const [actions, setActions] = useState([]);
  const [pendingActions, setPendingActions] = useState([]);
  const [decisionMetrics, setDecisionMetrics] = useState(null);
  const [capabilityHealth, setCapabilityHealth] = useState([]);
  const [capabilityHealthError, setCapabilityHealthError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showQuickStart, setShowQuickStart] = useState(true);

  const isDemo = isDemoMode();

  const fetchAll = useCallback(async () => {
    const agentParam = agentId ? `agent_id=${encodeURIComponent(agentId)}` : '';
    const withParams = (base, extra = []) => {
      const params = [...extra];
      if (agentParam) params.push(agentParam);
      return `${base}${params.length ? `?${params.join('&')}` : ''}`;
    };

    try {
      const [signalsRes, loopsRes, healthRes, actionsRes, pendingRes, metricsRes, capabilityHealthRes] = await Promise.all([
        fetch(withParams('/api/signals')),
        fetch(withParams('/api/actions/loops', ['status=open', 'limit=20'])),
        fetch('/api/health'),
        fetch(withParams('/api/actions', ['limit=12'])),
        fetch(withParams('/api/actions', ['status=pending_approval', 'limit=10'])),
        fetch(withParams('/api/actions/stats')),
        fetch('/api/capabilities/health?limit=20'),
      ]);

      if (signalsRes.ok) setSignals(await signalsRes.json());
      if (loopsRes.ok) setLoops(await loopsRes.json());
      if (healthRes.ok) setHealth(await healthRes.json());
      if (metricsRes.ok) setDecisionMetrics(await metricsRes.json());
      if (actionsRes.ok) {
        const actionsJson = await actionsRes.json();
        setActions(actionsJson.actions || []);
      }
      if (pendingRes.ok) {
        const pendingJson = await pendingRes.json();
        setPendingActions(pendingJson.actions || []);
      }
      if (capabilityHealthRes.ok) {
        const capabilityHealthJson = await capabilityHealthRes.json();
        setCapabilityHealth(capabilityHealthJson.capabilities || []);
        setCapabilityHealthError(null);
      } else {
        setCapabilityHealth([]);
        setCapabilityHealthError('Capability health unavailable');
      }
    } catch (error) {
      console.error('Mission Control fetch error:', error);
      setCapabilityHealth([]);
      setCapabilityHealthError('Capability health unavailable');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    setLoading(true);
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  useRealtime(useCallback((event, payload) => {
    if (['action.created', 'action.updated', 'loop.created', 'loop.updated', 'guard.decision.created', 'signal.detected'].includes(event)) {
      if (agentId) {
        const source = payload.action || payload.loop || payload.decision || payload;
        if (source.agent_id && source.agent_id !== agentId) return;
      }
      fetchAll();
    }
  }, [agentId, fetchAll]));

  /* ---------- Derived state ---------- */

  // Apply the same client-side dismissal filter used by the Security page.
  // Dismissed signal hashes are stored in localStorage under 'dashclaw_dismissed_signals'.
  const getSignalHash = (s) =>
    `${s.type || s.signal_type || ''}:${s.agent_id || ''}:${s.action_id || ''}:${s.loop_id || ''}:${s.assumption_id || ''}`;

  const [dismissedVersion, setDismissedVersion] = useState(0);

  // Cross-tab sync: listen for `storage` events from the Security page's
  // dismiss action. Previously `dismissedSet` only re-computed when
  // `signals` changed, so in a quiet system a dismiss in another tab could
  // stay invisible here indefinitely.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onStorage = (e) => {
      if (e.key === 'dashclaw_dismissed_signals') {
        setDismissedVersion((v) => v + 1);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const dismissedSet = useMemo(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('dashclaw_dismissed_signals');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  // Re-evaluate on any signals change AND any cross-tab storage event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, dismissedVersion]);

  const activeSignalList = useMemo(() => {
    const list = signals?.signals || [];
    return list.filter(s => !dismissedSet.has(getSignalHash(s)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, dismissedSet]);

  const signalCounts = {
    red: activeSignalList.filter(s => s.severity === 'red').length,
    amber: activeSignalList.filter(s => s.severity === 'amber').length,
    total: activeSignalList.length,
  };
  const posture = computePosture(signalCounts.red, signalCounts.amber);

  const loopList = useMemo(() => loops?.loops || [], [loops]);

  const healthStatus = health?.status || 'unknown';
  const healthDot = healthStatus === 'healthy' ? 'bg-status-success' : healthStatus === 'degraded' ? 'bg-status-warning' : 'bg-zinc-500';
  const healthLabel = healthStatus === 'healthy' ? 'Healthy' : healthStatus === 'degraded' ? 'Degraded' : 'Unknown';
  const healthColor = healthStatus === 'healthy' ? 'text-success' : healthStatus === 'degraded' ? 'text-warning' : 'text-tertiary';

  const lastActivity = actions[0]?.timestamp_start || loopList[0]?.created_at || null;
  const fleetCount = agents.length;

  // Intervention card data
  const interventions = useMemo(
    () => buildInterventionList(pendingActions, loopList),
    [pendingActions, loopList]
  );
  const hasPendingApprovals = pendingActions.length > 0;

  // Fleet: identify degraded agents by cross-referencing loops + recent actions
  const criticalAgentIds = useMemo(() => {
    const ids = new Set();
    for (const loop of loopList) {
      if (loop.priority === 'critical' && loop.agent_id) ids.add(loop.agent_id);
    }
    return ids;
  }, [loopList]);

  const failedAgentIds = useMemo(() => {
    const ids = new Set();
    const seen = new Set();
    for (const action of actions) {
      if (!action.agent_id || seen.has(action.agent_id)) continue;
      seen.add(action.agent_id);
      if (action.status === 'failed' || action.status === 'blocked') {
        ids.add(action.agent_id);
      }
    }
    return ids;
  }, [actions]);

  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      const aDegraded = criticalAgentIds.has(a.agent_id) || failedAgentIds.has(a.agent_id) || a.status === 'degraded' || a.status === 'blocked';
      const bDegraded = criticalAgentIds.has(b.agent_id) || failedAgentIds.has(b.agent_id) || b.status === 'degraded' || b.status === 'blocked';
      if (aDegraded && !bDegraded) return -1;
      if (!aDegraded && bDegraded) return 1;
      return 0;
    });
  }, [agents, criticalAgentIds, failedAgentIds]);

  const actionButton = (
    <Link
      href="/decisions"
      className="inline-flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
    >
      View Decisions <ArrowRight size={14} />
    </Link>
  );

  return (
    <PageLayout
      title="Mission Control"
      subtitle="Fleet posture, interventions, and decision intelligence"
      breadcrumbs={['Mission Control']}
      actions={actionButton}
      maturity="stable"
    >
      {/* ═══ Activation: Quick Start (Only if no agents or in demo mode for review) ═══ */}
      {!loading && (agents.length === 0 || isDemo) && showQuickStart && (
        <QuickStart onDismiss={() => setShowQuickStart(false)} />
      )}

      {/* ═══ BAND 1: Command Strip ═══ */}
      {loading ? <CommandStripSkeleton /> : (
        <div className="mb-6 rounded-xl border border-border bg-surface-tertiary px-5 py-3">
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-3">
            {/* System Posture */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Posture</span>
              <div className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 ${posture.bg} ${posture.border}`}>
                <div className={`h-1.5 w-1.5 rounded-full ${posture.color.replace('text-', 'bg-')} ${posture.pulse ? 'animate-pulse' : ''}`} />
                <span className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${posture.color}`}>
                  {posture.label}
                </span>
              </div>
            </div>

            <div className="hidden h-3.5 w-px bg-border sm:block" />

            {/* Fleet count */}
            <div className="flex items-center gap-2">
              <Users size={13} className="text-tertiary" />
              <span className="text-sm font-medium tabular-nums text-white">{fleetCount}</span>
              <span className="text-[11px] uppercase tracking-[0.14em] text-tertiary">agents</span>
            </div>

            <div className="hidden h-3.5 w-px bg-border sm:block" />

            {/* DB Health */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Database</span>
              <span className={`h-1.5 w-1.5 rounded-full ${healthDot}`} />
              <span className={`text-sm font-medium ${healthColor}`}>{healthLabel}</span>
            </div>

            <div className="hidden h-3.5 w-px bg-border sm:block" />

            {/* Active interventions */}
            <div className="flex items-center gap-2">
              <Activity size={13} className="text-tertiary" />
              <span className="text-sm font-medium tabular-nums text-white">{interventions.length}</span>
              <span className="text-[11px] uppercase tracking-[0.14em] text-tertiary">
                {interventions.length === 1 ? 'intervention' : 'interventions'}
              </span>
            </div>

            <div className="hidden h-3.5 w-px bg-border sm:block" />

            {/* Last activity */}
            <div className="hidden sm:flex items-center gap-2">
              <Clock size={13} className="text-tertiary" />
              <span className="text-sm text-secondary tabular-nums">{formatRelativeTime(lastActivity)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ═══ BAND 2: Signal Quadrants ═══ */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Intervention Required — priority slot, spans 2 cols at lg */}
        <Card className="md:col-span-2" hover={false}>
          <div className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                  Intervention Required
                </span>
                {hasPendingApprovals && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-error/30 bg-error-subtle px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-error">
                    <span className="h-1 w-1 animate-pulse rounded-full bg-status-error" />
                    Urgent
                  </span>
                )}
              </div>
              {interventions.length > 0 && (
                <Link
                  href="/approvals"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-brand transition-colors hover:text-brand-hover"
                >
                  Queue <ArrowRight size={10} />
                </Link>
              )}
            </div>
            {loading ? <InterventionSkeleton /> : interventions.length === 0 ? (
              <div className="flex items-center gap-2 py-1">
                <CheckCircle2 size={16} className="text-success/60" />
                <span className="text-sm text-secondary">No intervention required</span>
              </div>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex shrink-0 items-baseline gap-1.5 sm:w-28">
                  <div className="text-4xl font-semibold tabular-nums text-white">{interventions.length}</div>
                  <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">
                    {interventions.length === 1 ? 'item' : 'items'}
                  </div>
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  {interventions.slice(0, 4).map((item) => (
                    <Link
                      key={item.id}
                      href={item.href}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-white/5 focus:bg-white/5 focus:outline-none"
                    >
                      <Badge
                        variant={item.kind === 'approval' ? 'error' : 'warning'}
                        size="xs"
                      >
                        {item.kind === 'approval' ? 'Approval' : 'Loop'}
                      </Badge>
                      <span className={`shrink-0 truncate rounded border px-1.5 py-0.5 text-[10px] font-medium ${getAgentColor(item.agentId)}`} style={{ maxWidth: '7.5rem' }}>
                        {(item.agentName || '').substring(0, 14) || item.agentId?.substring(0, 8) || 'system'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-secondary">
                        {truncateText(item.description, 80)}
                      </span>
                      <ArrowRight size={10} className="shrink-0 text-tertiary" />
                    </Link>
                  ))}
                  {interventions.length > 4 && (
                    <Link href="/approvals" className="block px-2 pt-1 text-xs text-brand transition-colors hover:text-brand-hover">
                      +{interventions.length - 4} more
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Risk Signals */}
        <Card>
          <div className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Risk Signals</span>
              <Link href="/security" className="inline-flex items-center gap-1 text-[11px] font-medium text-brand transition-colors hover:text-brand-hover">
                View <ArrowRight size={10} />
              </Link>
            </div>
            {loading ? <MetricSkeleton /> : signalCounts.total === 0 ? (
              <div className="flex items-center gap-2 py-1">
                <ShieldCheck size={16} className="text-success/60" />
                <span className="text-sm text-secondary">No signals</span>
              </div>
            ) : (
              <>
                <div className="mb-2 text-4xl font-semibold tabular-nums text-white">{signalCounts.total}</div>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {signalCounts.red > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-status-error" />
                      <span className="font-medium text-error">{signalCounts.red} critical</span>
                    </span>
                  )}
                  {signalCounts.amber > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-status-warning" />
                      <span className="font-medium text-warning">{signalCounts.amber} elevated</span>
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Decisions (24h) */}
        <Card>
          <div className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Decisions · 24h</span>
              <Link href="/decisions" className="inline-flex items-center gap-1 text-[11px] font-medium text-brand transition-colors hover:text-brand-hover">
                History <ArrowRight size={10} />
              </Link>
            </div>
            {loading || !decisionMetrics ? <MetricSkeleton /> : (
              <>
                <div className="mb-1 flex items-baseline gap-2">
                  <div className="text-4xl font-semibold tabular-nums text-white">{decisionMetrics.total}</div>
                  <div className={`flex items-center gap-0.5 text-xs font-medium tabular-nums ${decisionMetrics.change_percent >= 0 ? 'text-success' : 'text-error'}`}>
                    {decisionMetrics.change_percent >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {decisionMetrics.change_percent >= 0 ? '+' : ''}{decisionMetrics.change_percent}%
                  </div>
                </div>
                <div className="mb-4 text-[11px] text-tertiary">vs. previous 24h</div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-tertiary">Completed</span>
                    <span className="text-xs font-semibold tabular-nums text-success">{decisionMetrics.completed}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-tertiary">Failed</span>
                    <span className="text-xs font-semibold tabular-nums text-error">{decisionMetrics.failed}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-tertiary">Cancelled</span>
                    <span className="text-xs font-semibold tabular-nums text-warning">{decisionMetrics.cancelled}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-tertiary">Approval</span>
                    <span className="text-xs font-semibold tabular-nums text-brand">{decisionMetrics.approval}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Fleet Status */}
        <Card>
          <div className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Fleet Status</span>
              <Link href="/agents" className="inline-flex items-center gap-1 text-[11px] font-medium text-brand transition-colors hover:text-brand-hover">
                Manage <ArrowRight size={10} />
              </Link>
            </div>
            {loading ? <MetricSkeleton /> : agents.length === 0 ? (
              <div className="text-sm text-tertiary">No agents connected</div>
            ) : (
              <div className="space-y-1.5">
                {sortedAgents.slice(0, 5).map((agent) => {
                  const isCritical = criticalAgentIds.has(agent.agent_id);
                  const isDegraded = isCritical || failedAgentIds.has(agent.agent_id) || agent.status === 'degraded' || agent.status === 'blocked';
                  return (
                    <Link
                      key={agent.agent_id}
                      href={`/agents/${encodeURIComponent(agent.agent_id)}`}
                      className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-white/5 focus:bg-white/5 focus:outline-none"
                    >
                      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${isDegraded ? 'bg-status-warning' : 'bg-status-success/50'}`} />
                      <span className={`flex-1 truncate text-xs ${isDegraded ? 'text-warning' : 'text-secondary'}`}>
                        {agent.name || agent.agent_id}
                      </span>
                      {isCritical && <AlertTriangle size={10} className="shrink-0 text-error" />}
                    </Link>
                  );
                })}
                {agents.length > 5 && (
                  <Link href="/agents" className="block px-1.5 pt-1 text-[11px] text-tertiary transition-colors hover:text-secondary">
                    +{agents.length - 5} more
                  </Link>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Agent Spend */}
        <Card>
          <div className="p-5">
            <AgentSpendCard agentId={agentId} />
          </div>
        </Card>

        {/* Capability Health */}
        <MissionControlCapabilityHealthCard
          loading={loading}
          error={capabilityHealthError}
          capabilities={capabilityHealth}
        />

        {/* Runtime Summary */}
        <Card>
          <RuntimeSummaryCard />
        </Card>
      </div>

      {/* ═══ BAND 3: Operations Feed ═══ */}
      <OperationsFeed agentId={agentId} onRefreshRequest={fetchAll} />
    </PageLayout>
  );
}

