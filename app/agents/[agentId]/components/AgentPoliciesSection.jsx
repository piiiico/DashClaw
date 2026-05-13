'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '../../../components/ui/Badge';
import { Shield, Plus, X, ToggleLeft, ToggleRight } from 'lucide-react';

function parseAgentIds(policy) {
  if (!policy.agent_ids) return [];
  try { const p = JSON.parse(policy.agent_ids); return Array.isArray(p) ? p : []; } catch { return []; }
}

function formatPolicyRules(policy) {
  const policyType = policy.policy_type || policy.type;
  let rules;
  try { rules = JSON.parse(policy.rules || '{}'); } catch { return policyType; }
  switch (policyType) {
    case 'risk_threshold': return `Risk >= ${rules.threshold} \u2192 ${rules.action || 'block'}`;
    case 'require_approval': return `${(rules.action_types || []).join(', ')} \u2192 require approval`;
    case 'block_action_type': return `${(rules.action_types || []).join(', ')} \u2192 block`;
    case 'rate_limit': return `Max ${rules.max_actions} / ${rules.window_minutes}min`;
    case 'webhook_check': return 'Webhook check';
    case 'semantic_check': return `Semantic: "${(rules.instruction || '').slice(0, 40)}..."`;
    default: return policyType;
  }
}

export default function AgentPoliciesSection({ agentId, policies, allPolicies, onRefresh }) {
  const [showPicker, setShowPicker] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const applicablePolicies = (policies || []).filter(p => {
    const ids = parseAgentIds(p);
    return ids.length === 0 || ids.includes(agentId);
  });

  const unassignedPolicies = (allPolicies || []).filter(p => {
    const ids = parseAgentIds(p);
    if (ids.length === 0) return false;
    return !ids.includes(agentId);
  });

  const handleAssign = async (policy) => {
    setAssigning(true);
    try {
      const currentIds = parseAgentIds(policy);
      const newIds = [...currentIds, agentId];
      const res = await fetch('/api/policies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: policy.id, agent_ids: JSON.stringify(newIds) }),
      });
      if (res.ok) onRefresh?.();
    } catch { /* ignore */ }
    finally { setAssigning(false); }
  };

  const handleUnassign = async (policy) => {
    setAssigning(true);
    try {
      const currentIds = parseAgentIds(policy);
      const newIds = currentIds.filter(id => id !== agentId);
      const res = await fetch('/api/policies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: policy.id, agent_ids: newIds.length > 0 ? JSON.stringify(newIds) : null }),
      });
      if (res.ok) onRefresh?.();
    } catch { /* ignore */ }
    finally { setAssigning(false); }
  };

  const handleToggleActive = async (policy) => {
    setAssigning(true);
    try {
      const res = await fetch('/api/policies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: policy.id, active: policy.active === 1 ? 0 : 1 }),
      });
      if (res.ok) onRefresh?.();
    } catch { /* ignore */ }
    finally { setAssigning(false); }
  };

  const activeCount = applicablePolicies.filter(p => p.active === 1).length;

  return (
    <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#111] px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-tertiary" />
          <span className="text-sm font-medium text-white">Policies</span>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-secondary">{activeCount} of {applicablePolicies.length} active</span>
        </div>
        <button onClick={() => setShowPicker(!showPicker)} className="flex items-center gap-1 text-xs text-brand hover:text-brand/80">
          <Plus size={12} /> Manage
        </button>
      </div>
      {applicablePolicies.length === 0 ? (
        <div className="py-4 text-center text-sm text-tertiary">No policies apply to this agent.</div>
      ) : (
        <div className="space-y-2">
          {applicablePolicies.map(p => {
            const isGlobal = parseAgentIds(p).length === 0;
            const isActive = p.active === 1;
            return (
              <div key={p.id} className={`flex items-center justify-between gap-3 rounded-lg bg-white/[0.02] px-3 py-2 ${isActive ? '' : 'opacity-60'}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <Badge size="xs">{p.policy_type || p.type}</Badge>
                  <Badge variant={isActive ? 'success' : 'default'} size="xs">{isActive ? 'active' : 'inactive'}</Badge>
                  <span className="text-xs text-secondary truncate">{formatPolicyRules(p)}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={isGlobal ? 'default' : 'brand'} size="xs">{isGlobal ? 'global' : 'agent'}</Badge>
                  <button
                    onClick={() => handleToggleActive(p)}
                    disabled={assigning}
                    className="text-tertiary hover:text-white disabled:opacity-50"
                    aria-label={isActive ? `Deactivate ${p.name || p.policy_type}` : `Activate ${p.name || p.policy_type}`}
                    title={isActive ? 'Deactivate policy (affects all agents)' : 'Activate policy (affects all agents)'}
                  >
                    {isActive ? <ToggleRight size={16} className="text-brand" /> : <ToggleLeft size={16} />}
                  </button>
                  {!isGlobal && (
                    <button onClick={() => handleUnassign(p)} disabled={assigning} className="text-tertiary hover:text-error disabled:opacity-50" aria-label={`Unassign ${p.name || p.policy_type} from this agent`}><X size={12} /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {showPicker && (
        <div className="mt-3 border-t border-white/[0.04] pt-3">
          <div className="text-[10px] uppercase tracking-widest text-tertiary mb-2">Assign policy</div>
          {unassignedPolicies.length > 0 ? (
            <div className="space-y-1">
              {unassignedPolicies.map(p => (
                <button key={p.id} onClick={() => handleAssign(p)} disabled={assigning} className="w-full flex items-center justify-between gap-3 rounded-lg bg-white/[0.02] px-3 py-2 text-left hover:bg-white/[0.04] disabled:opacity-50">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge size="xs">{p.policy_type || p.type}</Badge>
                    <span className="text-xs text-secondary truncate">{formatPolicyRules(p)}</span>
                  </div>
                  <Plus size={12} className="text-brand shrink-0" />
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-lg bg-white/[0.02] px-3 py-3 text-xs text-tertiary">
              No agent-scoped policies available to assign. Global policies (shown above) already apply to every agent.{' '}
              <Link href="/policies" className="text-brand hover:underline">
                Create or edit policies →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
