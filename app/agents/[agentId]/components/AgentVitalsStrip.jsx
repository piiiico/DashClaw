import { Brain, Fingerprint } from 'lucide-react';

const presenceDot = {
  online: 'bg-status-success',
  stale: 'bg-status-warning',
  offline: 'bg-zinc-500',
  unknown: 'bg-zinc-500',
};

const presenceLabel = {
  online: 'Online',
  stale: 'Stale',
  offline: 'Offline',
  unknown: 'Unknown',
};

function formatRelativeTime(isoString) {
  if (!isoString) return 'Never';
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AgentVitalsStrip({ agent, identityVerified }) {
  const status = agent.presence?.status || 'unknown';

  return (
    <div className="rounded-2xl border border-border bg-surface-secondary px-5 py-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 border border-brand/20 text-brand">
            <Brain size={20} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white truncate">{agent.agent_name}</h2>
              {identityVerified && (
                <span className="flex items-center gap-1 rounded-full bg-success-subtle border border-success/20 px-2 py-0.5 text-[10px] font-semibold text-success uppercase tracking-wide">
                  <Fingerprint size={10} /> Verified
                </span>
              )}
            </div>
            <div className="font-mono text-xs text-tertiary truncate">{agent.agent_id}</div>
          </div>
        </div>
        <div className="flex items-center gap-6 text-xs text-secondary">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${presenceDot[status]}`} />
            <span className="text-secondary">{presenceLabel[status]}</span>
            <span className="text-tertiary">&middot;</span>
            <span>Last seen {formatRelativeTime(agent.presence?.last_heartbeat_at || agent.last_active)}</span>
          </div>
          <div className="hidden sm:flex items-center gap-4">
            <span><span className="text-white font-medium">{(agent.action_count || 0).toLocaleString()}</span> actions</span>
          </div>
        </div>
      </div>
    </div>
  );
}
