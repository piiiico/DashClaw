'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck } from 'lucide-react';
import OperationsFeedItem from './OperationsFeedItem';

const CATEGORIES: { key: string | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'approval', label: 'Approvals' },
  { key: 'failure', label: 'Failures' },
  { key: 'signal', label: 'Signals' },
  { key: 'health', label: 'Health' },
  { key: 'stale', label: 'Stale' },
];

const SEVERITY_BADGE: Record<string, { color: string; label: string }> = {
  critical: { color: 'bg-status-error', label: 'Critical' },
  high: { color: 'bg-brand', label: 'High' },
  medium: { color: 'bg-status-warning', label: 'Medium' },
  low: { color: 'bg-status-info', label: 'Low' },
};

interface FeedCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

interface OperationsFeedProps {
  agentId?: string;
  onRefreshRequest?: () => void;
}

export default function OperationsFeed({ agentId, onRefreshRequest }: OperationsFeedProps) {
  const [items, setItems] = useState<any[]>([]);
  const [counts, setCounts] = useState<FeedCounts>({ critical: 0, high: 0, medium: 0, low: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const fetchFeed = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (activeCategory) params.set('category', activeCategory);
      if (agentId) params.set('agent_id', agentId);
      params.set('limit', '50');
      const res = await fetch(`/api/operations/feed?${params}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setCounts(data.counts || { critical: 0, high: 0, medium: 0, low: 0, total: 0 });
      }
    } catch {
      // Silently fail — feed is supplementary
    } finally {
      setLoading(false);
    }
  }, [activeCategory, agentId]);

  useEffect(() => {
    fetchFeed();
    const interval = setInterval(fetchFeed, 30000);
    return () => clearInterval(interval);
  }, [fetchFeed]);

  const handleApprove = async (actionId: string) => {
    try {
      const res = await fetch(`/api/approvals/${actionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'allow' }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.source_id !== actionId));
        setCounts((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) }));
        if (onRefreshRequest) onRefreshRequest();
      }
    } catch { /* ignore */ }
  };

  const handleDeny = async (actionId: string) => {
    try {
      const res = await fetch(`/api/approvals/${actionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'deny' }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.source_id !== actionId));
        setCounts((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) }));
        if (onRefreshRequest) onRefreshRequest();
      }
    } catch { /* ignore */ }
  };

  const handleRetry = async (metadata: any) => {
    if (!metadata?.template_id || !metadata?.run_action_id) return;
    try {
      const res = await fetch(`/api/workflows/templates/${metadata.template_id}/runs/${metadata.run_action_id}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        fetchFeed();
        if (onRefreshRequest) onRefreshRequest();
      }
    } catch { /* ignore */ }
  };

  const handleCancel = async (metadata: any) => {
    if (!metadata?.template_id || !metadata?.run_action_id) return;
    try {
      const res = await fetch(`/api/workflows/templates/${metadata.template_id}/runs/${metadata.run_action_id}/cancel`, {
        method: 'POST',
      });
      if (res.ok) {
        fetchFeed();
        if (onRefreshRequest) onRefreshRequest();
      }
    } catch { /* ignore */ }
  };

  const handleDisable = async (metadata: any) => {
    if (!metadata?.capability_id) return;
    try {
      const res = await fetch(`/api/capabilities/${metadata.capability_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ health_status: 'disabled' }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.source_id !== metadata.capability_id));
        setCounts((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) }));
        if (onRefreshRequest) onRefreshRequest();
      }
    } catch { /* ignore */ }
  };

  return (
    <div className="rounded-xl border border-border bg-surface-secondary">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
            Operations Feed
          </span>
          {counts.total > 0 && (
            <span className="text-xs font-medium tabular-nums text-secondary">· {counts.total}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {Object.entries(SEVERITY_BADGE).map(([sev, cfg]) => (
            (counts as any)[sev] > 0 && (
              <span key={sev} className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${cfg.color}`} />
                <span className="text-[11px] font-medium tabular-nums text-secondary">{(counts as any)[sev]}</span>
              </span>
            )
          ))}
        </div>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-1 border-b border-border px-4 py-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key || 'all'}
            onClick={() => setActiveCategory(cat.key)}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              activeCategory === cat.key
                ? 'border-brand/30 bg-brand/10 text-brand'
                : 'border-transparent text-tertiary hover:border-border hover:text-secondary'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Feed items */}
      <div className="max-h-[560px] overflow-y-auto">
        {loading ? (
          <div className="p-6 text-center">
            <div className="animate-pulse text-sm text-tertiary">Loading operations feed…</div>
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center">
            <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-success/40" />
            <p className="text-sm text-secondary">All clear — no items need attention.</p>
          </div>
        ) : (
          <div className="divide-y divide-border p-2">
            {items.map((item) => (
              <OperationsFeedItem
                key={item.id}
                item={item}
                onApprove={item.category === 'approval' ? handleApprove : undefined}
                onDeny={item.category === 'approval' ? handleDeny : undefined}
                onRetry={item.suggested_action === 'retry' ? handleRetry : undefined}
                onDisable={item.suggested_action === 'disable' ? handleDisable : undefined}
                onCancel={item.suggested_action === 'cancel' ? handleCancel : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
