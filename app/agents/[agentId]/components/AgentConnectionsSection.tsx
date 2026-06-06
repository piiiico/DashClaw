'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plug } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Skeleton } from '../../../components/ui/Skeleton';

const AUTH_TYPE_VARIANT: Record<string, string> = {
  api_key: 'default',
  oauth: 'info',
  subscription: 'success',
  pre_configured: 'warning',
  environment: 'default',
};

const STATUS_VARIANT: Record<string, string> = { active: 'success', inactive: 'default', error: 'error' };

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface AgentConnectionsSectionProps {
  agentId: string;
}

export default function AgentConnectionsSection({ agentId }: AgentConnectionsSectionProps) {
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConnections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/connections?agent_id=${encodeURIComponent(agentId)}`);
      if (res.ok) {
        const data = await res.json();
        setConnections(data.connections || []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (agentId) fetchConnections();
  }, [agentId, fetchConnections]);

  return (
    <section className="rounded-xl border border-border bg-surface-secondary p-5">
      <div className="mb-3 flex items-center gap-2">
        <Plug size={14} className="text-tertiary" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-white">Provider connections</h2>
        {!loading && <span className="text-xs text-tertiary">{connections.length}</span>}
      </div>

      {loading ? (
        <Skeleton className="h-16 w-full rounded-lg" />
      ) : connections.length === 0 ? (
        <p className="text-xs text-tertiary">No provider connections reported for this agent.</p>
      ) : (
        <div className="divide-y divide-border">
          {connections.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <span className="text-sm font-medium text-white">{c.provider}</span>
              {c.auth_type && (
                <Badge size="xs" variant={AUTH_TYPE_VARIANT[c.auth_type] || 'default'}>{c.auth_type}</Badge>
              )}
              {c.plan_name && <Badge size="xs" variant="info">{c.plan_name}</Badge>}
              <Badge size="xs" variant={STATUS_VARIANT[c.status] || 'default'}>{c.status}</Badge>
              <span className="ml-auto text-[11px] text-tertiary">{relativeTime(c.reported_at)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
