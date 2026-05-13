'use client';

import Link from 'next/link';

const SEVERITY_DOT = {
  critical: 'bg-status-error',
  high: 'bg-brand',
  medium: 'bg-status-warning',
  low: 'bg-status-info',
};

const CATEGORY_PILL = {
  approval: { label: 'Approval', color: 'bg-purple-400/10 text-purple-400 border-purple-400/20' },
  failure: { label: 'Failure', color: 'bg-red-400/10 text-error border-error/20' },
  signal: { label: 'Signal', color: 'bg-amber-400/10 text-warning border-warning/20' },
  health: { label: 'Health', color: 'bg-blue-400/10 text-info border-blue-400/20' },
  stale: { label: 'Stale', color: 'bg-zinc-400/10 text-secondary border-zinc-400/20' },
};

function formatRelativeTime(ts) {
  if (!ts) return '—';
  const parsed = new Date(ts).getTime();
  if (!Number.isFinite(parsed)) return '—';
  const diffMs = Date.now() - parsed;
  if (diffMs < 0) return 'now';
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.floor(diffHours / 24)}d`;
}

export default function OperationsFeedItem({ item, onApprove, onDeny, onRetry, onDisable, onCancel }) {
  const dot = SEVERITY_DOT[item.severity] || SEVERITY_DOT.low;
  const pill = CATEGORY_PILL[item.category] || CATEGORY_PILL.signal;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:border-border-hover hover:bg-white/[0.02]">
      <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${dot}`} />

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${pill.color}`}>
            {pill.label}
          </span>
          {item.agent_id && (
            <span className="max-w-[140px] truncate text-[11px] text-tertiary">{item.agent_id}</span>
          )}
          <span className="ml-auto flex-shrink-0 text-[11px] tabular-nums text-tertiary">
            {formatRelativeTime(item.timestamp)}
          </span>
        </div>

        <Link href={item.action_url || '#'} className="text-sm text-secondary transition-colors hover:text-white">
          {item.title}
        </Link>

        {item.detail && (
          <p className="mt-0.5 truncate text-xs text-tertiary">{item.detail}</p>
        )}
      </div>

      <div className="mt-1 flex flex-shrink-0 items-center gap-1.5">
        {item.category === 'approval' && onApprove && onDeny && (
          <>
            <button
              onClick={() => onApprove(item.source_id)}
              className="rounded-md border border-success/20 bg-emerald-400/10 px-2 py-1 text-[11px] font-medium text-success transition-colors hover:border-success/40 hover:bg-emerald-400/20"
            >
              Approve
            </button>
            <button
              onClick={() => onDeny(item.source_id)}
              className="rounded-md border border-error/20 bg-red-400/10 px-2 py-1 text-[11px] font-medium text-error transition-colors hover:border-error/40 hover:bg-red-400/20"
            >
              Deny
            </button>
          </>
        )}
        {item.suggested_action === 'retry' && onRetry && (
          <button
            onClick={() => onRetry(item.metadata)}
            className="rounded-md border border-blue-400/20 bg-blue-400/10 px-2 py-1 text-[11px] font-medium text-info transition-colors hover:border-blue-400/40 hover:bg-blue-400/20"
          >
            Retry
          </button>
        )}
        {item.suggested_action === 'cancel' && onCancel && (
          <button
            onClick={() => onCancel(item.metadata)}
            className="rounded-md border border-error/20 bg-red-400/10 px-2 py-1 text-[11px] font-medium text-error transition-colors hover:border-error/40 hover:bg-red-400/20"
          >
            Cancel
          </button>
        )}
        {item.suggested_action === 'disable' && onDisable && (
          <button
            onClick={() => onDisable(item.metadata)}
            className="rounded-md border border-warning/20 bg-amber-400/10 px-2 py-1 text-[11px] font-medium text-warning transition-colors hover:border-warning/40 hover:bg-amber-400/20"
          >
            Disable
          </button>
        )}
        {item.category !== 'approval' && (
          <Link
            href={item.action_url || '#'}
            className="rounded-md border border-border bg-white/5 px-2 py-1 text-[11px] font-medium text-secondary transition-colors hover:border-border-hover hover:bg-white/10 hover:text-secondary"
          >
            View
          </Link>
        )}
      </div>
    </div>
  );
}
