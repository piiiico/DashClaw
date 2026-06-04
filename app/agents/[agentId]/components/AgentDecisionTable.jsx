'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Skeleton } from '../../../components/ui/Skeleton';
import {
  CheckCircle2, XCircle, Clock, Loader2, Ban,
  ChevronDown, ChevronUp,
} from 'lucide-react';

const statusIcon = {
  completed: CheckCircle2, failed: XCircle, pending: Clock,
  running: Loader2, cancelled: Ban, blocked: Ban, pending_approval: Clock,
};
const statusVariant = {
  completed: 'success', failed: 'error', running: 'warning',
  cancelled: 'default', pending: 'info', blocked: 'error', pending_approval: 'info',
};

function riskColor(score) {
  if (score >= 70) return 'text-error';
  if (score >= 30) return 'text-warning';
  return 'text-secondary';
}

function formatRelativeTime(isoString) {
  if (!isoString) return '\u2014';
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AgentDecisionTable({ agentId }) {
  const [actions, setActions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterRiskMin, setFilterRiskMin] = useState('1');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const fetchActions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('agent_id', agentId);
      params.set('limit', limit.toString());
      params.set('offset', offset.toString());
      if (filterStatus) params.set('status', filterStatus);
      else params.set('exclude_status', 'running');
      if (filterType) params.set('action_type', filterType);
      if (filterRiskMin) params.set('risk_min', filterRiskMin);
      const res = await fetch(`/api/actions?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (offset === 0) {
          setActions(data.actions || []);
        } else {
          setActions(prev => [...prev, ...(data.actions || [])]);
        }
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch decisions:', err);
    } finally {
      setLoading(false);
    }
  }, [agentId, filterStatus, filterType, filterRiskMin, offset]);

  useEffect(() => { setOffset(0); }, [filterStatus, filterType, filterRiskMin]);
  useEffect(() => { fetchActions(); }, [fetchActions]);

  return (
    <div className="rounded-2xl border border-border bg-surface-secondary">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">Decision History</span>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-secondary">{total}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="rounded-lg border border-white/5 bg-surface-tertiary px-2 py-1 text-xs text-secondary focus:outline-none focus:border-brand/50">
            <option value="">All statuses</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="blocked">Blocked</option>
            <option value="pending_approval">Pending approval</option>
            <option value="running">Running</option>
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="rounded-lg border border-white/5 bg-surface-tertiary px-2 py-1 text-xs text-secondary focus:outline-none focus:border-brand/50">
            <option value="">All types</option>
            {['build','deploy','post','apply','security','message','api','research','review','fix','refactor','test','config','monitor'].map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select value={filterRiskMin} onChange={e => setFilterRiskMin(e.target.value)} className="rounded-lg border border-white/5 bg-surface-tertiary px-2 py-1 text-xs text-secondary focus:outline-none focus:border-brand/50">
            <option value="">Any risk</option>
            <option value="1">Risk 1+</option>
            <option value="30">Risk 30+</option>
            <option value="50">Risk 50+</option>
            <option value="70">Risk 70+</option>
          </select>
        </div>
      </div>
      {loading && actions.length === 0 ? (
        <div className="p-5 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      ) : actions.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-tertiary">No decisions match the current filters.</div>
      ) : (
        <div className="divide-y divide-white/[0.04]">
          {actions.map(action => {
            const StatusIcon = statusIcon[action.status] || Clock;
            const expanded = expandedId === action.action_id;
            return (
              <div key={action.action_id}>
                <button onClick={() => setExpandedId(prev => prev === action.action_id ? null : action.action_id)} className="w-full flex items-center gap-4 px-5 py-3 text-left hover:bg-white/[0.02] transition-colors">
                  <Badge variant={statusVariant[action.status] || 'default'} size="xs">
                    <StatusIcon size={10} className="mr-1" />
                    {action.status}
                  </Badge>
                  <span className="text-xs text-tertiary w-20 shrink-0">{action.action_type}</span>
                  <span className="text-sm text-secondary truncate flex-1">{action.declared_goal || '\u2014'}</span>
                  <span className={`text-xs font-mono w-8 text-right ${riskColor(action.risk_score)}`}>{action.risk_score ?? '\u2014'}</span>
                  <span className="text-xs text-tertiary w-20 text-right shrink-0">{formatRelativeTime(action.timestamp_start)}</span>
                  {expanded ? <ChevronUp size={14} className="text-tertiary" /> : <ChevronDown size={14} className="text-tertiary" />}
                </button>
                {expanded && (
                  <div className="bg-white/[0.02] border-t border-white/[0.04] px-5 py-4 space-y-2 text-xs">
                    {action.reasoning && <div><span className="text-tertiary">Reasoning:</span> <span className="text-secondary">{action.reasoning}</span></div>}
                    {action.input_summary && <div><span className="text-tertiary">Input:</span> <span className="text-secondary">{action.input_summary}</span></div>}
                    {action.output_summary && <div><span className="text-tertiary">Output:</span> <span className="text-secondary">{action.output_summary}</span></div>}
                    {action.error_message && <div><span className="text-tertiary">Error:</span> <span className="text-error">{action.error_message}</span></div>}
                    {action.duration_ms != null && <div><span className="text-tertiary">Duration:</span> <span className="text-secondary">{(action.duration_ms / 1000).toFixed(1)}s</span></div>}
                    {action.cost_estimate != null && action.cost_estimate > 0 && <div><span className="text-tertiary">Cost:</span> <span className="text-secondary">${action.cost_estimate.toFixed(4)}</span></div>}
                    {action.approved_by && <div><span className="text-tertiary">Approved by:</span> <span className="text-success">{action.approved_by}</span></div>}
                    <div className="font-mono text-disabled pt-1">{action.action_id}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {actions.length < total && (
        <div className="border-t border-white/[0.04] px-5 py-3 text-center">
          <button onClick={() => setOffset(actions.length)} disabled={loading} className="text-xs text-brand hover:text-brand/80 disabled:opacity-50">
            {loading ? 'Loading...' : `Load more (${actions.length} of ${total})`}
          </button>
        </div>
      )}
    </div>
  );
}
