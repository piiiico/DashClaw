'use client';

import { useState, useRef } from 'react';
import AgentScopePicker from './AgentScopePicker';
import RiskExplainer from './RiskExplainer';

const ACTION_OPTIONS = [
  'build', 'deploy', 'post', 'apply', 'security', 'message', 'api',
  'calendar', 'research', 'review', 'fix', 'refactor', 'test', 'config',
  'monitor', 'alert', 'cleanup', 'sync', 'migrate', 'other',
];

const DECISION_OPTIONS = [
  { value: 'block', label: 'Block' },
  { value: 'require_approval', label: 'Require Approval' },
  { value: 'warn', label: 'Warn' },
];

const WINDOW_OPTIONS = [
  { value: 15, label: '15 minutes' },
  { value: 60, label: '1 hour' },
  { value: 240, label: '4 hours' },
  { value: 1440, label: '24 hours' },
];

function parseRules(policy: any): any {
  try { return JSON.parse(policy?.rules || '{}'); } catch { return {}; }
}

function parseAgentIds(policy: any): string[] {
  if (!policy?.agent_ids) return [];
  try { const p = JSON.parse(policy.agent_ids); return Array.isArray(p) ? p : []; } catch { return []; }
}

interface ShieldConfigProps {
  shield: any;
  policy: any;
  onSaved?: () => void;
}

export default function ShieldConfig({ shield, policy, onSaved }: ShieldConfigProps) {
  const rules = parseRules(policy);
  const [config, setConfig] = useState<any>({ ...shield.defaultRules, ...rules });
  const [agentIds, setAgentIds] = useState<string[]>(parseAgentIds(policy));
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = (newConfig: any, newAgentIds: string[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const payload = {
          id: policy.id,
          rules: JSON.stringify({ ...newConfig, _shield: shield.id }),
          agent_ids: newAgentIds.length > 0 ? JSON.stringify(newAgentIds) : null,
        };
        const res = await fetch('/api/policies', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
          onSaved?.();
        }
      } catch { /* ignore */ }
    }, 500);
  };

  const updateConfig = (key: string, value: any) => {
    const next = { ...config, [key]: value };
    setConfig(next);
    save(next, agentIds);
  };

  const updateAgentIds = (ids: string[]) => {
    setAgentIds(ids);
    save(config, ids);
  };

  const resetDefaults = () => {
    setConfig({ ...shield.defaultRules });
    setAgentIds([]);
    save({ ...shield.defaultRules }, []);
  };

  return (
    <div className="mt-4 space-y-4 border-t border-white/[0.04] pt-4">
      {/* Type-specific fields */}
      {shield.policyType === 'risk_threshold' && (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-tertiary block mb-1">Risk Threshold</label>
            <div className="flex items-center gap-3">
              <input
                type="range" min="0" max="100" value={config.threshold || 70}
                onChange={e => updateConfig('threshold', parseInt(e.target.value, 10))}
                className="flex-1 accent-brand"
              />
              <span className={`font-mono text-sm font-medium w-8 text-right ${
                (config.threshold || 70) >= 70 ? 'text-error' : (config.threshold || 70) >= 30 ? 'text-warning' : 'text-success'
              }`}>
                {config.threshold || 70}
              </span>
            </div>
            <div className="flex justify-between text-[10px] text-disabled mt-1">
              <span>Low risk</span><span>Medium</span><span>High risk</span>
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-tertiary block mb-1">Action</label>
            <select value={config.action || 'block'} onChange={e => updateConfig('action', e.target.value)} className="w-full rounded-lg border border-white/5 bg-surface-tertiary px-3 py-2 text-xs text-secondary focus:outline-none focus:border-brand/50">
              {DECISION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <RiskExplainer />
        </div>
      )}

      {(shield.policyType === 'require_approval' || shield.policyType === 'block_action_type') && (
        <div>
          <label className="text-[10px] uppercase tracking-widest text-tertiary block mb-2">Action Types</label>
          <div className="flex flex-wrap gap-1.5">
            {ACTION_OPTIONS.map(type => {
              const active = (config.action_types || []).includes(type);
              return (
                <button
                  key={type}
                  onClick={() => {
                    const types = active
                      ? (config.action_types || []).filter((t: string) => t !== type)
                      : [...(config.action_types || []), type];
                    updateConfig('action_types', types);
                  }}
                  className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                    active ? 'bg-brand/15 border border-brand/40 text-brand' : 'bg-white/5 border border-white/5 text-secondary hover:text-white'
                  }`}
                >
                  {type}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {shield.policyType === 'rate_limit' && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-tertiary block mb-1">Max Actions</label>
            <input type="number" min="1" value={config.max_actions || 30} onChange={e => updateConfig('max_actions', parseInt(e.target.value, 10) || 1)} className="w-full rounded-lg border border-white/5 bg-surface-tertiary px-3 py-2 text-xs text-secondary focus:outline-none focus:border-brand/50" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-tertiary block mb-1">Time Window</label>
            <select value={config.window_minutes || 60} onChange={e => updateConfig('window_minutes', parseInt(e.target.value, 10))} className="w-full rounded-lg border border-white/5 bg-surface-tertiary px-3 py-2 text-xs text-secondary focus:outline-none focus:border-brand/50">
              {WINDOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-tertiary block mb-1">Action</label>
            <select value={config.action || 'warn'} onChange={e => updateConfig('action', e.target.value)} className="w-full rounded-lg border border-white/5 bg-surface-tertiary px-3 py-2 text-xs text-secondary focus:outline-none focus:border-brand/50">
              {DECISION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {shield.policyType === 'semantic_check' && (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-tertiary block mb-1">Instruction</label>
            <textarea value={config.instruction || ''} onChange={e => updateConfig('instruction', e.target.value)} rows={3} className="w-full rounded-lg border border-white/5 bg-surface-tertiary px-3 py-2 text-xs text-secondary focus:outline-none focus:border-brand/50 resize-none" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-tertiary block mb-1">Fallback</label>
            <select value={config.fallback || 'allow'} onChange={e => updateConfig('fallback', e.target.value)} className="w-full rounded-lg border border-white/5 bg-surface-tertiary px-3 py-2 text-xs text-secondary focus:outline-none focus:border-brand/50">
              <option value="allow">Allow (fail-open)</option>
              <option value="block">Block (fail-closed)</option>
            </select>
            <div className="mt-1 text-[10px] text-tertiary">Requires GUARD_LLM_KEY or OPENAI_API_KEY environment variable.</div>
          </div>
        </div>
      )}

      {shield.policyType === 'non_fabrication' && (
        <div className="space-y-3">
          <div className="text-[10px] text-tertiary">
            Verifies the action&apos;s outbound content against a source-of-truth. Attach <code className="text-secondary">content</code> + <code className="text-secondary">source_of_truth</code> to the action; a fabricated fact (amount, date, percentage, or registered ID not in the source) is held per the action below. Fail-closed: a missing source-of-truth blocks.
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-tertiary block mb-1">On Violation</label>
            <select value={config.on_violation || 'require_approval'} onChange={e => updateConfig('on_violation', e.target.value)} className="w-full rounded-lg border border-white/5 bg-surface-tertiary px-3 py-2 text-xs text-secondary focus:outline-none focus:border-brand/50">
              <option value="block">Block (fail-closed)</option>
              <option value="require_approval">Require Approval</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-tertiary block mb-2">Action Types <span className="text-tertiary normal-case tracking-normal">(optional — empty applies to all)</span></label>
            <div className="flex flex-wrap gap-1.5">
              {ACTION_OPTIONS.map(type => {
                const active = (config.action_types || []).includes(type);
                return (
                  <button
                    key={type}
                    onClick={() => {
                      const types = active
                        ? (config.action_types || []).filter((t: string) => t !== type)
                        : [...(config.action_types || []), type];
                      updateConfig('action_types', types);
                    }}
                    className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                      active ? 'bg-brand/15 border border-brand/40 text-brand' : 'bg-white/5 border border-white/5 text-secondary hover:text-white'
                    }`}
                  >
                    {type}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {shield.policyType === 'webhook_check' && (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-tertiary block mb-1">Webhook URL (HTTPS)</label>
            <input type="url" value={config.url || ''} onChange={e => updateConfig('url', e.target.value)} placeholder="https://api.example.com/guard" className="w-full rounded-lg border border-white/5 bg-surface-tertiary px-3 py-2 text-xs text-secondary focus:outline-none focus:border-brand/50" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-tertiary block mb-1">Timeout</label>
              <select value={config.timeout_ms || 5000} onChange={e => updateConfig('timeout_ms', parseInt(e.target.value, 10))} className="w-full rounded-lg border border-white/5 bg-surface-tertiary px-3 py-2 text-xs text-secondary focus:outline-none focus:border-brand/50">
                <option value="1000">1 second</option>
                <option value="3000">3 seconds</option>
                <option value="5000">5 seconds</option>
                <option value="10000">10 seconds</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-tertiary block mb-1">On Timeout</label>
              <select value={config.on_timeout || 'allow'} onChange={e => updateConfig('on_timeout', e.target.value)} className="w-full rounded-lg border border-white/5 bg-surface-tertiary px-3 py-2 text-xs text-secondary focus:outline-none focus:border-brand/50">
                <option value="allow">Allow (fail-open)</option>
                <option value="block">Block (fail-closed)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Agent scope — shared across all types */}
      <AgentScopePicker agentIds={agentIds} onChange={updateAgentIds} />

      {/* Footer */}
      <div className="flex items-center justify-between pt-2">
        <button onClick={resetDefaults} className="text-xs text-tertiary hover:text-secondary transition-colors">
          Reset to defaults
        </button>
        {saved && <span className="text-xs text-success">Saved</span>}
      </div>
    </div>
  );
}
