'use client';

import { useEffect, useRef } from 'react';
import {
  X, AlertTriangle, ShieldAlert, Zap, CircleDot, Clock,
  ExternalLink, Shield, Undo2, Info
} from 'lucide-react';
import { Badge } from './ui/Badge';
import { ProgressBar } from './ui/ProgressBar';
import { getAgentColor } from '../lib/colors';
import { parseJsonArray as parseSideEffects } from '../lib/parseJson';

function AgentDot({ agentId }) {
  if (!agentId) return null;
  const colorClass = getAgentColor(agentId);
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${colorClass}`}>
      {agentId}
    </span>
  );
}

function SignalDetail({ signal, onClose, onDismiss }) {
  const severityVariant = signal.severity === 'red' ? 'error' : 'warning';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <ShieldAlert size={18} className={signal.severity === 'red' ? 'text-error' : 'text-warning'} />
          <div>
            <div className="text-sm font-medium text-white">{signal.label}</div>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge variant={severityVariant} size="xs">
                {signal.severity === 'red' ? 'Critical' : 'Warning'}
              </Badge>
              <span className="text-[10px] text-tertiary uppercase tracking-wider">{signal.type.replace(/_/g, ' ')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Agent */}
      {signal.agent_id && (
        <div>
          <div className="text-[10px] text-tertiary uppercase tracking-wider mb-1.5">Agent</div>
          <AgentDot agentId={signal.agent_id} />
        </div>
      )}

      {/* Detail */}
      <div>
        <div className="text-[10px] text-tertiary uppercase tracking-wider mb-1.5">Detail</div>
        <p className="text-sm text-secondary">{signal.detail}</p>
      </div>

      {/* Help */}
      {signal.help && (
        <div className="bg-status-info/5 border border-blue-500/10 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <Info size={14} className="text-info mt-0.5 shrink-0" />
            <p className="text-sm text-info">{signal.help}</p>
          </div>
        </div>
      )}

      {/* Related links */}
      {signal.action_id && (
        <a
          href={`/actions/${signal.action_id}`}
          className="flex items-center gap-1.5 text-sm text-brand hover:text-brand/80 transition-colors"
        >
          <ExternalLink size={14} />
          View Action Post-Mortem
        </a>
      )}

      {/* Dismiss */}
      {onDismiss && (
        <button
          onClick={() => { onDismiss(signal); onClose(); }}
          className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-secondary hover:text-white hover:bg-white/5 transition-colors"
        >
          <X size={14} />
          Dismiss Signal
        </button>
      )}
    </div>
  );
}

function ActionDetail({ action }) {
  const riskScore = parseInt(action.risk_score, 10) || 0;
  const riskColor = riskScore >= 90 ? 'error' : riskScore >= 70 ? 'warning' : 'brand';
  const statusVariant = action.status === 'running' ? 'warning' : action.status === 'failed' ? 'error' : action.status === 'completed' ? 'success' : 'default';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Zap size={16} className="text-secondary" />
          <Badge variant={statusVariant} size="xs">{action.status}</Badge>
          {action.action_type && (
            <span className="text-[10px] text-tertiary uppercase tracking-wider">{action.action_type}</span>
          )}
        </div>
        <div className="text-sm font-medium text-white">{action.declared_goal || 'No goal declared'}</div>
      </div>

      {/* Agent */}
      {action.agent_id && (
        <div>
          <div className="text-[10px] text-tertiary uppercase tracking-wider mb-1.5">Agent</div>
          <AgentDot agentId={action.agent_id} />
        </div>
      )}

      {/* Risk Score */}
      <div>
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-tertiary">Risk Score</span>
          <span className="text-white font-medium tabular-nums">{riskScore}/100</span>
        </div>
        <ProgressBar value={riskScore} color={riskColor} className="h-2" />
      </div>

      {/* Reasoning */}
      {action.reasoning && (
        <div>
          <div className="text-[10px] text-tertiary uppercase tracking-wider mb-1.5">Reasoning</div>
          <p className="text-sm text-secondary">{action.reasoning}</p>
        </div>
      )}

      {/* Authorization scope */}
      {action.authorization_scope && (
        <div>
          <div className="text-[10px] text-tertiary uppercase tracking-wider mb-1.5">Authorization Scope</div>
          <p className="text-sm text-secondary font-mono">{action.authorization_scope}</p>
        </div>
      )}

      {/* Reversible / Side effects */}
      <div className="flex items-center gap-3">
        <div
          className="flex items-center gap-1.5"
          title="The agent declared whether this action can be rolled back. DashClaw records the signal but does not execute reversals — use the system the agent touched to undo it."
        >
          <Undo2 size={14} className={action.reversible === 1 ? 'text-success' : 'text-error'} />
          <span className="text-xs text-secondary">
            {action.reversible === 1 ? 'Self-recoverable (agent asserted)' : 'Not self-recoverable'}
          </span>
        </div>
        {parseSideEffects(action.side_effects).length > 0 && (
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={14} className="text-warning" />
            <span className="text-xs text-secondary">Has side effects</span>
          </div>
        )}
      </div>

      {/* Side effects detail */}
      {parseSideEffects(action.side_effects).length > 0 && (
        <div>
          <div className="text-[10px] text-tertiary uppercase tracking-wider mb-1.5">Side Effects</div>
          <ul className="text-sm text-secondary list-disc pl-5 space-y-0.5">
            {parseSideEffects(action.side_effects).map((se, i) => (
              <li key={i}>{typeof se === 'string' ? se : JSON.stringify(se)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Link to post-mortem */}
      <a
        href={`/actions/${action.action_id}`}
        className="flex items-center gap-1.5 text-sm text-brand hover:text-brand/80 transition-colors"
      >
        <ExternalLink size={14} />
        View Post-Mortem
      </a>
    </div>
  );
}

export default function SecurityDetailPanel({ item, type, onClose, onDismiss }) {
  const panelRef = useRef(null);
  const closeBtnRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  const titleId = `security-panel-title-${type}`;

  useEffect(() => {
    if (!item) return;

    previouslyFocusedRef.current = document.activeElement;
    closeBtnRef.current?.focus();

    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [item, onClose]);

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop — decorative, click-to-close. Escape and the close button
          provide the keyboard equivalents, so this element is intentionally
          aria-hidden to avoid double-announcement to screen readers. */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-surface-secondary border-l border-border overflow-y-auto"
      >
        {/* Close button */}
        <div className="sticky top-0 bg-surface-secondary z-10 flex items-center justify-between px-5 py-4 border-b border-border">
          <span
            id={titleId}
            className="text-xs font-medium text-tertiary uppercase tracking-wider"
          >
            {type === 'signal' ? 'Signal Detail' : 'Action Detail'}
          </span>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close detail panel"
            className="p-1.5 text-tertiary hover:text-white transition-colors"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5">
          {type === 'signal' ? (
            <SignalDetail signal={item} onClose={onClose} onDismiss={onDismiss} />
          ) : (
            <ActionDetail action={item} />
          )}
        </div>
      </div>
    </div>
  );
}
