import { Card, CardContent, CardHeader } from '../../../components/ui/Card';

function formatPercent(value) {
  if (typeof value !== 'number') return '0%';
  return `${Math.round(value)}%`;
}

function formatLatency(value) {
  if (typeof value !== 'number') return 'n/a';
  return `${value} ms`;
}

function formatTimestamp(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

const DEFAULT_METRICS = [
  { label: '1d success rate', key: 'success_rate_1d', format: formatPercent },
  { label: '7d success rate', key: 'success_rate_7d', format: formatPercent },
  { label: 'p95 latency', key: 'p95_latency_ms', format: formatLatency },
  { label: 'Stale check', key: 'stale_check', format: (value) => (value ? 'Stale' : 'Fresh') },
];

// Invocation counters the /health endpoint already returns but the page never
// surfaced (volume, last success/failure, pending approvals, recent errors).
const COUNT_STATS = [
  { label: 'Total invocations', key: 'total_invocations' },
  { label: 'Successful', key: 'successful_invocations' },
  { label: 'Failed', key: 'failed_invocations' },
  { label: 'Pending approvals', key: 'pending_approvals' },
];

export default function CapabilityHealthCards({ health }) {
  const recentErrors = Array.isArray(health?.recent_errors) ? health.recent_errors : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {DEFAULT_METRICS.map((metric) => (
          <Card key={metric.key} hover={false}>
            <CardHeader title={metric.label} />
            <CardContent>
              <div className="text-2xl font-semibold text-white">
                {metric.format(health?.[metric.key])}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card hover={false}>
        <CardHeader title="Invocation detail" />
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {COUNT_STATS.map((stat) => (
              <div key={stat.key} className="rounded-lg border border-border bg-surface-tertiary p-3 text-center">
                <div className="text-lg font-semibold text-white tabular-nums">
                  {Number(health?.[stat.key] ?? 0)}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-tertiary mt-1">{stat.label}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-tertiary">Last success</span>
              <span className="text-white text-right">{formatTimestamp(health?.last_success_at)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-tertiary">Last failure</span>
              <span className="text-white text-right">{formatTimestamp(health?.last_failure_at)}</span>
            </div>
            {health?.last_test_duration_ms != null && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-tertiary">Last test duration</span>
                <span className="text-white text-right">{health.last_test_duration_ms} ms</span>
              </div>
            )}
            {health?.last_test_summary && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-tertiary">Last test</span>
                <span className="text-white text-right truncate" title={health.last_test_summary}>{health.last_test_summary}</span>
              </div>
            )}
          </div>

          {recentErrors.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-tertiary mb-2">Recent errors</div>
              <ul className="space-y-1.5">
                {recentErrors.map((err, i) => (
                  <li key={i} className="rounded-lg border border-error/20 bg-error-subtle px-3 py-2 text-xs">
                    <div className="text-error">{err.message || 'Unknown error'}</div>
                    {err.timestamp && (
                      <div className="text-tertiary mt-0.5 tabular-nums">{formatTimestamp(err.timestamp)}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
