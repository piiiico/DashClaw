'use client';

import { useState } from 'react';
import {
  Rocket, AlertTriangle, ShieldAlert, Ban, Timer, Globe, Lock, MessageSquare, BadgeCheck,
} from 'lucide-react';
import ShieldConfig from './ShieldConfig';

const ICON_MAP = {
  Rocket, AlertTriangle, ShieldAlert, Ban, Timer, Globe, Lock, MessageSquare, BadgeCheck,
};

export default function ShieldCard({ shield, policy, onToggle, onSaved }) {
  const [expanded, setExpanded] = useState(false);
  const [toggling, setToggling] = useState(false);
  const isActive = policy && policy.active === 1;
  const Icon = ICON_MAP[shield.icon] || ShieldAlert;

  const handleToggle = async () => {
    setToggling(true);
    await onToggle(shield, policy, !isActive);
    setToggling(false);
  };

  // Parse stats from policy if available
  let statsText = null;
  if (isActive && policy?.stats) {
    const parts = [];
    if (policy.stats.blocks > 0) parts.push(`${policy.stats.blocks} blocked`);
    if (policy.stats.approvals > 0) parts.push(`${policy.stats.approvals} approvals`);
    if (policy.stats.warns > 0) parts.push(`${policy.stats.warns} warns`);
    if (parts.length > 0) statsText = parts.join(' \u00b7 ');
  }

  const agentIds = (() => {
    if (!policy?.agent_ids) return [];
    try { const p = JSON.parse(policy.agent_ids); return Array.isArray(p) ? p : []; } catch { return []; }
  })();

  return (
    <div
      className={`rounded-xl border bg-surface-secondary transition-colors ${
        isActive
          ? 'border-brand/30 hover:border-brand/40'
          : 'border-border hover:border-border-hover'
      }`}
    >
      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                isActive
                  ? 'border-brand/20 bg-brand/10 text-brand'
                  : 'border-border bg-surface-tertiary text-tertiary'
              }`}
            >
              <Icon size={18} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className={`text-sm font-semibold ${isActive ? 'text-white' : 'text-secondary'}`}>
                {shield.name}
              </div>
              <div className="mt-0.5 text-xs text-tertiary">{shield.description}</div>
            </div>
          </div>

          {/* Toggle */}
          <button
            onClick={handleToggle}
            disabled={toggling}
            role="switch"
            aria-checked={isActive}
            className={`relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand/40 focus:ring-offset-2 focus:ring-offset-surface-secondary ${
              isActive ? 'bg-brand' : 'bg-white/10'
            } ${toggling ? 'opacity-50' : ''}`}
            aria-label={`${isActive ? 'Disable' : 'Enable'} ${shield.name}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                isActive ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        {/* Stats strip */}
        {isActive && statsText && (
          <div className="mt-3 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs tabular-nums text-secondary">
            {statsText}
          </div>
        )}

        {/* Agent scope + configure */}
        {isActive && (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-tertiary">
              {agentIds.length === 0 ? 'All agents' : `${agentIds.length} agent${agentIds.length === 1 ? '' : 's'}`}
            </span>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-brand transition-colors hover:text-brand-hover"
            >
              {expanded ? 'Close' : 'Configure'}
            </button>
          </div>
        )}

        {/* Expanded config */}
        {isActive && expanded && policy && (
          <ShieldConfig shield={shield} policy={policy} onSaved={onSaved} />
        )}
      </div>
    </div>
  );
}
