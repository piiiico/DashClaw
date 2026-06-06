'use client';

import { useState, useEffect } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { CheckCircle2, XCircle, HelpCircle, AlertTriangle } from 'lucide-react';

function formatAge(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const days = Math.floor((Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return '1d';
  return `${days}d`;
}

interface AssumptionSummary {
  total: number;
  validated: number;
  invalidated: number;
  unverified: number;
}

interface AgentAssumptionsProps {
  agentId: string;
  summary: AssumptionSummary;
}

export default function AgentAssumptions({ agentId, summary }: AgentAssumptionsProps) {
  const [assumptions, setAssumptions] = useState<any[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const fetchNotable = async () => {
      try {
        const res = await fetch(`/api/assumptions?agent_id=${encodeURIComponent(agentId)}&limit=20`);
        if (res.ok) {
          const data = await res.json();
          setAssumptions(data.assumptions || []);
        }
      } catch (err) {
        console.error('Failed to fetch assumptions:', err);
      }
    };
    fetchNotable();
  }, [agentId]);

  const sorted = [...assumptions].sort((a, b) => {
    if (a.invalidated && !b.invalidated) return -1;
    if (!a.invalidated && b.invalidated) return 1;
    if (!a.validated && !a.invalidated && (b.validated || b.invalidated)) return -1;
    if ((a.validated || a.invalidated) && !b.validated && !b.invalidated) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const visible = showAll ? sorted : sorted.slice(0, 5);

  return (
    <div className="rounded-2xl border border-border bg-surface-secondary px-5 py-4">
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">Assumptions</span>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-secondary">{summary.total}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success" size="xs"><CheckCircle2 size={10} className="mr-1" />{summary.validated} validated</Badge>
          <Badge variant="error" size="xs"><XCircle size={10} className="mr-1" />{summary.invalidated} invalidated</Badge>
          <Badge variant="default" size="xs"><HelpCircle size={10} className="mr-1" />{summary.unverified} unverified</Badge>
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="py-6 text-center text-sm text-tertiary">No assumptions recorded for this agent.</div>
      ) : (
        <div className="space-y-3">
          {visible.map(asm => {
            const isInvalidated = asm.invalidated === 1 || asm.invalidated === true;
            const isValidated = asm.validated === 1 || asm.validated === true;
            return (
              <div key={asm.assumption_id} className="flex items-start gap-3">
                {isInvalidated ? <XCircle size={14} className="mt-0.5 shrink-0 text-error" /> : isValidated ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" /> : <HelpCircle size={14} className="mt-0.5 shrink-0 text-tertiary" />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-secondary">{asm.assumption}</div>
                  {asm.basis && <div className="mt-0.5 text-xs text-tertiary">Basis: {asm.basis}</div>}
                  {isInvalidated && asm.invalidated_reason && <div className="mt-0.5 text-xs text-error">Reason: {asm.invalidated_reason}</div>}
                  {!isValidated && !isInvalidated && asm.drift_score >= 50 && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-warning"><AlertTriangle size={10} /> Drift score: {asm.drift_score}</div>
                  )}
                </div>
                <span className="shrink-0 text-xs text-tertiary">
                  {isInvalidated ? 'invalidated' : isValidated ? 'validated' : 'unverified'} &middot; {formatAge(asm.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {sorted.length > 5 && !showAll && (
        <button onClick={() => setShowAll(true)} className="mt-3 text-xs text-brand hover:text-brand/80">
          Show all {sorted.length}
        </button>
      )}
    </div>
  );
}
