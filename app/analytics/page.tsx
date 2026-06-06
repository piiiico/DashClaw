'use client';

import { useState, useEffect, useCallback } from 'react';
import PageLayout from '../components/PageLayout';
import { Skeleton } from '../components/ui/Skeleton';
import HeroStats from './components/HeroStats';
import CostTrendChart from './components/CostTrendChart';
import ActionVolumeChart from './components/ActionVolumeChart';
import BreakdownCard from './components/BreakdownCard';
import TokenUsage from './components/TokenUsage';

const RANGES = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics?days=${days}`);
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const policyItems = data ? [
    { label: 'Blocked', count: data.policy_enforcement.blocked, pct: data.policy_enforcement.total > 0 ? Math.round((data.policy_enforcement.blocked / data.policy_enforcement.total) * 1000) / 10 : 0 },
    { label: 'Approvals', count: data.policy_enforcement.require_approval, pct: data.policy_enforcement.total > 0 ? Math.round((data.policy_enforcement.require_approval / data.policy_enforcement.total) * 1000) / 10 : 0 },
    { label: 'Warnings', count: data.policy_enforcement.warn, pct: data.policy_enforcement.total > 0 ? Math.round((data.policy_enforcement.warn / data.policy_enforcement.total) * 1000) / 10 : 0 },
  ] : [];

  return (
    <PageLayout
      title="Analytics"
      subtitle="Cost, usage, and efficiency metrics"
      breadcrumbs={['Measure', 'Analytics']}
      maturity="beta"
      actions={
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-tertiary p-0.5">
          {RANGES.map(r => (
            <button
              key={r.value}
              onClick={() => setDays(r.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                days === r.value ? 'bg-brand/15 text-brand' : 'text-secondary hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      {loading && !data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-64 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        </div>
      ) : data ? (
        <div className="space-y-6">
          <HeroStats hero={data.hero} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CostTrendChart daily={data.daily} />
            <ActionVolumeChart daily={data.daily} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <BreakdownCard
              title="By Agent"
              items={data.by_agent}
              labelKey="agent_name"
              countLabel="cost"
            />
            <BreakdownCard
              title="By Action Type"
              items={data.by_action_type}
              labelKey="action_type"
              countLabel="cost"
            />
            <BreakdownCard
              title="Policy Enforcement"
              items={policyItems}
              labelKey="label"
              countLabel="count"
            />
          </div>

          <TokenUsage tokens={data.tokens} />
        </div>
      ) : (
        <div className="text-center py-12 text-sm text-tertiary">Failed to load analytics data.</div>
      )}
    </PageLayout>
  );
}
