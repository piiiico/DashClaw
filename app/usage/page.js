'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import {
  AlertTriangle, ArrowRight, Zap,
  Users, KeyRound, Bot, BarChart3,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';

function UsageMeter({ label, icon: Icon, usage, limit, className = '' }) {
  const isUnlimited = limit == null || limit === Infinity || limit === -1;
  const displayLimit = isUnlimited ? 'Unlimited' : limit.toLocaleString();

  return (
    <Card hover={false} className={className}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon size={14} className="text-secondary" />
          <span className="text-xs text-secondary">{label}</span>
        </div>
        <div className="flex items-baseline gap-1.5 mb-1">
          <span className="text-lg font-semibold tabular-nums text-white">{usage.toLocaleString()}</span>
          <span className="text-xs text-tertiary">/ {displayLimit}</span>
        </div>
        <div className="text-[10px] text-tertiary uppercase tracking-wider font-medium">
          Current Usage
        </div>
      </CardContent>
    </Card>
  );
}

export default function UsagePage() {
  return (
    <Suspense fallback={
      <PageLayout title="Usage" subtitle="Monitor your workspace activity" breadcrumbs={['Dashboard', 'Usage']}>
        <div className="flex items-center justify-center py-20">
          <div className="text-sm text-tertiary">Loading usage info...</div>
        </div>
      </PageLayout>
    }>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const [billing, setBilling] = useState(null);
  const [costs, setCosts] = useState(null); // /api/usage/costs — per-type + daily spend
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [error, setError] = useState(null);

  const fetchUsage = useCallback(async () => {
    try {
      const [res, costsRes] = await Promise.all([
        fetch('/api/usage'),
        fetch('/api/usage/costs'),
      ]);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to load usage data');
        setLoading(false);
        return;
      }

      setBilling(data);
      if (costsRes.ok) setCosts(await costsRes.json().catch(() => null));
    } catch {
      setError('Failed to connect to API');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  // Loading state
  if (loading) {
    return (
      <PageLayout
        title="Usage"
        subtitle="Monitor your workspace activity"
        breadcrumbs={['Dashboard', 'Usage']}
      >
        <div className="flex items-center justify-center py-20">
          <div className="text-sm text-tertiary">Loading usage info...</div>
        </div>
      </PageLayout>
    );
  }

  const usage = billing?.usage || {};
  const limits = billing?.limits || {};

  return (
    <PageLayout
      title="Usage"
      subtitle="Monitor your workspace activity and resource consumption"
      breadcrumbs={['Dashboard', 'Usage']}
    >
      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-error-subtle border border-error/20 rounded-lg text-sm text-error flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-error hover:text-error ml-4">&times;</button>
        </div>
      )}

      {/* Usage meters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <UsageMeter
          label="Actions this month"
          icon={Zap}
          usage={usage.actions_per_month || 0}
          limit={limits.actions_per_month}
        />
        <UsageMeter
          label="Active agents"
          icon={Bot}
          usage={usage.agents || 0}
          limit={limits.agents}
        />
        <UsageMeter
          label="Team members"
          icon={Users}
          usage={usage.members || 0}
          limit={limits.members}
        />
        <UsageMeter
          label="API keys"
          icon={KeyRound}
          usage={usage.api_keys || 0}
          limit={limits.api_keys}
        />
      </div>

      {/* Estimated spend (/api/usage/costs) — per-action-type + daily breakdown */}
      {costs && costs.total_actions > 0 && (
        <Card hover={false} className="mb-6">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BarChart3 size={16} className="text-brand" />
                <h3 className="text-sm font-medium text-secondary">Estimated spend · {costs.period}</h3>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold tabular-nums text-white">${(costs.total_cost_usd || 0).toFixed(3)}</div>
                <div className="text-[10px] text-tertiary uppercase tracking-wider">{costs.total_actions} actions</div>
              </div>
            </div>

            {Object.keys(costs.breakdown || {}).length > 0 && (
              <div className="space-y-1.5 mb-4">
                {Object.entries(costs.breakdown)
                  .sort((a, b) => b[1].cost_usd - a[1].cost_usd)
                  .map(([type, b]) => (
                    <div key={type} className="flex items-center justify-between text-xs">
                      <span className="text-secondary">{type}</span>
                      <span className="tabular-nums text-tertiary">{b.count} · ${b.cost_usd.toFixed(3)}</span>
                    </div>
                  ))}
              </div>
            )}

            {costs.daily?.length > 0 && (() => {
              const maxCost = Math.max(...costs.daily.map((d) => d.cost_usd), 0.0001);
              return (
                <div>
                  <div className="text-[10px] text-tertiary uppercase tracking-wider mb-2">Daily spend</div>
                  <div className="flex items-end gap-1 h-16">
                    {costs.daily.map((d) => (
                      <div
                        key={String(d.date)}
                        className="flex-1 rounded-t bg-brand/60 min-h-[2px]"
                        style={{ height: `${Math.max((d.cost_usd / maxCost) * 100, 2)}%` }}
                        title={`${String(d.date).slice(0, 10)}: $${d.cost_usd.toFixed(3)} (${d.actions} actions)`}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      <Card hover={false}>
        <CardContent className="pt-5 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-subtle flex items-center justify-center">
              <BarChart3 size={18} className="text-brand" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-secondary">Open Source Edition</h3>
              <p className="text-xs text-tertiary mt-0.5">
                This instance of DashClaw is running the open-source version with unlimited resource quotas enabled.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </PageLayout>
  );
}

