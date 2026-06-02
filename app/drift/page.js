'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Activity, AlertTriangle, AlertCircle, Info, CheckCircle,
  RefreshCw, Play, TrendingUp, TrendingDown, Minus,
  XCircle, BarChart3,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { isDemoMode } from '../lib/isDemoMode';
import { demoDriftAlerts, demoDriftStats, demoDriftSnapshots } from '../lib/demoDriftData';

const TABS = [
  { id: 'alerts', label: 'Alerts' },
  { id: 'baselines', label: 'Baselines' },
  { id: 'trends', label: 'Trends' },
];

const SEVERITY_CONFIG = {
  critical: { icon: AlertTriangle, color: 'text-error', bg: 'bg-error-subtle border-error/30', variant: 'error' },
  warning: { icon: AlertCircle, color: 'text-warning', bg: 'bg-warning-subtle border-warning/30', variant: 'warning' },
  info: { icon: Info, color: 'text-info', bg: 'bg-info-subtle border-blue-500/30', variant: 'info' },
};

const DIRECTION_ICON = {
  increasing: TrendingUp,
  decreasing: TrendingDown,
  unknown: Minus,
};

function ZScoreBar({ zScore }) {
  const absZ = Math.abs(zScore);
  const maxZ = 5;
  const pct = Math.min((absZ / maxZ) * 100, 100);
  const color = absZ >= 3 ? 'bg-status-error' : absZ >= 2 ? 'bg-status-warning' : 'bg-status-info';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 tabular-nums text-[11px] text-tertiary">
        {zScore > 0 ? '+' : ''}{zScore}
      </span>
    </div>
  );
}

export default function DriftPage() {
  const { agentId } = useAgentFilter();
  const isDemo = isDemoMode();
  const [activeTab, setActiveTab] = useState('alerts');

  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  // Alert filters (backend supports severity / acknowledged / metric).
  const [severity, setSeverity] = useState('all');
  const [ackFilter, setAckFilter] = useState('all');
  const [metricFilter, setMetricFilter] = useState('all');
  const [metricCatalog, setMetricCatalog] = useState([]);
  const filtersActive = severity !== 'all' || ackFilter !== 'all' || metricFilter !== 'all';

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (isDemoMode()) {
        await new Promise((r) => setTimeout(r, 800));
        setAlerts(demoDriftAlerts);
        setStats(demoDriftStats);
        setSnapshots(demoDriftSnapshots);
        setLoading(false);
        return;
      }

      const params = agentId ? `?agent_id=${agentId}` : '';
      const alertParams = new URLSearchParams();
      if (agentId) alertParams.set('agent_id', agentId);
      alertParams.set('limit', '50');
      if (severity !== 'all') alertParams.set('severity', severity);
      if (ackFilter !== 'all') alertParams.set('acknowledged', ackFilter === 'ack' ? 'true' : 'false');
      if (metricFilter !== 'all') alertParams.set('metric', metricFilter);
      const [alertsRes, statsRes, snapshotsRes] = await Promise.all([
        fetch(`/api/drift/alerts?${alertParams}`),
        fetch(`/api/drift/stats${params}`),
        fetch(`/api/drift/snapshots${params}${params ? '&' : '?'}limit=30`),
      ]);
      if (alertsRes.ok) { const d = await alertsRes.json(); setAlerts(d.alerts || []); }
      if (statsRes.ok) { const d = await statsRes.json(); setStats(d); }
      if (snapshotsRes.ok) { const d = await snapshotsRes.json(); setSnapshots(d.snapshots || []); }
    } catch (err) {
      console.error('Failed to fetch drift data:', err);
    } finally {
      setLoading(false);
    }
  }, [agentId, severity, ackFilter, metricFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Populate the metric filter from the trackable-metric catalog (orphan route).
  useEffect(() => {
    if (isDemo) return;
    fetch('/api/drift/metrics')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.metrics) setMetricCatalog(d.metrics); })
      .catch(() => {});
  }, [isDemo]);

  const handleRunDetection = async () => {
    setRunning(true);
    try {
      // Step 1: Compute baselines
      await fetch('/api/drift/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'compute_baselines' }),
      });
      // Step 2: Run detection
      await fetch('/api/drift/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'detect' }),
      });
      // Step 3: Record snapshots
      await fetch('/api/drift/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'record_snapshots' }),
      });
      fetchData();
    } catch (err) {
      alert('Drift detection failed');
    } finally {
      setRunning(false);
    }
  };

  const handleAcknowledge = async (id) => {
    try {
      await fetch(`/api/drift/alerts/${id}`, { method: 'PATCH' });
      fetchData();
    } catch {
      alert('Failed to acknowledge alert');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this alert?')) return;
    try {
      await fetch(`/api/drift/alerts/${id}`, { method: 'DELETE' });
      fetchData();
    } catch {
      alert('Failed to delete alert');
    }
  };

  if (loading) {
    return (
      <PageLayout title="Drift detection" subtitle="Statistical behavioral drift analysis">
        <ListSkeleton />
      </PageLayout>
    );
  }

  const overall = stats?.overall || {};
  const selectClass = 'rounded-lg border border-border bg-surface-tertiary px-2.5 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20';

  return (
    <PageLayout
      title="Drift detection"
      subtitle="Statistical behavioral drift analysis"
      breadcrumbs={['Operations', 'Drift detection']}
      maturity="beta"
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={handleRunDetection}
            disabled={running}
            className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
          >
            {running ? <RefreshCw size={14} className="animate-spin" aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            {running ? 'Running…' : 'Run detection'}
          </button>
          <button
            onClick={fetchData}
            aria-label="Refresh"
            className="rounded-lg p-2 text-secondary transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand/40"
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Instrument rail */}
        <div className="grid grid-cols-2 divide-x divide-border overflow-hidden rounded-xl border border-border bg-surface-secondary md:grid-cols-5">
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Total alerts</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{overall.total_alerts || 0}</div>
          </div>
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Critical</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-error">{overall.critical_count || 0}</div>
          </div>
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Warning</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-warning">{overall.warning_count || 0}</div>
          </div>
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Info</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-info">{overall.info_count || 0}</div>
          </div>
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Unacknowledged</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${parseInt(overall.unacknowledged) > 0 ? 'text-warning' : 'text-secondary'}`}>
              {overall.unacknowledged || 0}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div role="tablist" className="flex items-center gap-1 border-b border-border">
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'text-white' : 'text-tertiary hover:text-secondary'
                }`}
              >
                {tab.label}
                {isActive && (
                  <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand" />
                )}
              </button>
            );
          })}
        </div>

        {activeTab === 'alerts' && (
          <Card>
            <CardHeader title="Drift alerts" icon={Activity} count={alerts.length} />
            <CardContent>
              {!isDemo && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={selectClass} aria-label="Filter by severity">
                    <option value="all">All severities</option>
                    <option value="critical">Critical</option>
                    <option value="warning">Warning</option>
                    <option value="info">Info</option>
                  </select>
                  <select value={ackFilter} onChange={(e) => setAckFilter(e.target.value)} className={selectClass} aria-label="Filter by acknowledgement">
                    <option value="all">All statuses</option>
                    <option value="unack">Unacknowledged</option>
                    <option value="ack">Acknowledged</option>
                  </select>
                  <select value={metricFilter} onChange={(e) => setMetricFilter(e.target.value)} className={selectClass} aria-label="Filter by metric">
                    <option value="all">All metrics</option>
                    {metricCatalog.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  {filtersActive && (
                    <button
                      onClick={() => { setSeverity('all'); setAckFilter('all'); setMetricFilter('all'); }}
                      className="text-[11px] text-tertiary transition-colors hover:text-secondary"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
              {alerts.length === 0 ? (
                <EmptyState
                  icon={Activity}
                  title={filtersActive ? 'No alerts match these filters' : 'No drift detected'}
                  description={filtersActive
                    ? 'Adjust or clear the filters to see more alerts.'
                    : 'Run drift detection to analyze behavioral patterns against baselines.'}
                />
              ) : (
                <div className="space-y-2">
                  {alerts.map(alert => {
                    const sevConf = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
                    const SevIcon = sevConf.icon;
                    const DirIcon = DIRECTION_ICON[alert.direction] || Minus;
                    return (
                      <div
                        key={alert.id}
                        className={`rounded-lg border px-3 py-3 ${
                          alert.acknowledged
                            ? 'border-border bg-surface-tertiary opacity-75'
                            : sevConf.bg
                        }`}
                      >
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <SevIcon size={14} className={sevConf.color} aria-hidden="true" />
                            <Badge variant={sevConf.variant} size="xs">{alert.severity}</Badge>
                            <Badge size="xs">{alert.metric}</Badge>
                            <span className="text-xs text-secondary">{alert.agent_id}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <ZScoreBar zScore={Number(alert.z_score)} />
                            <DirIcon
                              size={14}
                              className={alert.direction === 'increasing' ? 'text-error' : 'text-info'}
                              aria-hidden="true"
                            />
                            <span className="tabular-nums text-xs text-tertiary">
                              {alert.pct_change > 0 ? '+' : ''}{alert.pct_change}%
                            </span>
                            {!alert.acknowledged && (
                              <button
                                onClick={() => handleAcknowledge(alert.id)}
                                className="rounded p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-success"
                                aria-label={`Acknowledge ${alert.metric} alert`}
                              >
                                <CheckCircle size={14} />
                              </button>
                            )}
                            {alert.acknowledged && <Badge variant="success" size="xs">ack</Badge>}
                            <button
                              onClick={() => handleDelete(alert.id)}
                              className="rounded p-1 text-tertiary transition-colors hover:bg-error-subtle hover:text-error"
                              aria-label={`Delete ${alert.metric} alert`}
                            >
                              <XCircle size={12} />
                            </button>
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-secondary">{alert.description}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-4 text-[11px] tabular-nums text-tertiary">
                          <span>Baseline: {alert.baseline_mean} ± {alert.baseline_stddev}</span>
                          <span>Current: {alert.current_mean} ± {alert.current_stddev}</span>
                          <span>Samples: {alert.sample_count}</span>
                          <span className="ml-auto">{new Date(alert.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'baselines' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {stats?.recent_baselines && stats.recent_baselines.length > 0 ? (
              <>
                <Card>
                  <CardHeader title="Recent baselines" icon={BarChart3} count={stats.recent_baselines.length} />
                  <CardContent>
                    <div className="space-y-2">
                      {stats.recent_baselines.map((b, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-secondary">{b.agent_id}</span>
                            <Badge size="xs">{b.metric}</Badge>
                          </div>
                          <div className="flex items-center gap-3 text-xs tabular-nums">
                            <span className="text-secondary">mean: {Number(b.mean).toFixed(2)}</span>
                            <span className="text-tertiary">std: {Number(b.stddev).toFixed(2)}</span>
                            <span className="text-tertiary">{b.sample_count} samples</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {stats?.by_metric && stats.by_metric.length > 0 && (
                  <Card>
                    <CardHeader title="Alerts by metric" />
                    <CardContent>
                      <div className="space-y-2">
                        {stats.by_metric.map(m => (
                          <div key={m.metric} className="flex items-center justify-between py-1.5">
                            <span className="text-sm text-secondary">{m.metric}</span>
                            <div className="flex items-center gap-3 text-xs tabular-nums">
                              <span className="text-tertiary">{m.count} alerts</span>
                              <span className="text-secondary">avg |z|: {m.avg_z_score}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card>
                <CardContent className="py-16">
                  <EmptyState icon={BarChart3} title="No baselines computed" description="Click 'Run detection' to compute statistical baselines from your agent data." />
                </CardContent>
              </Card>
            )}

            {stats?.by_agent && stats.by_agent.length > 0 && (
              <Card>
                <CardHeader title="Alerts by agent" />
                <CardContent>
                  <div className="space-y-2">
                    {stats.by_agent.map(a => (
                      <div key={a.agent_id} className="flex items-center justify-between py-1.5">
                        <span className="text-sm text-secondary">{a.agent_id}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs tabular-nums text-tertiary">{a.count} alerts</span>
                          {a.critical > 0 && <Badge variant="error" size="xs">{a.critical} crit</Badge>}
                          {a.warning > 0 && <Badge variant="warning" size="xs">{a.warning} warn</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {activeTab === 'trends' && (
          <Card>
            <CardHeader title="Metric snapshots" icon={TrendingUp} count={snapshots.length} />
            <CardContent>
              {snapshots.length === 0 ? (
                <EmptyState icon={TrendingUp} title="No snapshot data" description="Snapshots are recorded when you run drift detection. Run it daily for trend data." />
              ) : (
                <div className="space-y-2">
                  {snapshots.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <Badge size="xs">{s.metric}</Badge>
                        {s.agent_id && <span className="text-xs text-secondary">{s.agent_id}</span>}
                      </div>
                      <div className="flex items-center gap-3 text-xs tabular-nums">
                        <span className="text-secondary">mean: {Number(s.mean).toFixed(2)}</span>
                        <span className="text-tertiary">std: {Number(s.stddev).toFixed(2)}</span>
                        <span className="text-tertiary">{s.sample_count} samples</span>
                        <span className="text-tertiary">{new Date(s.period_start).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}

