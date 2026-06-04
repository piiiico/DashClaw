'use client';

import { useState, useEffect } from 'react';
import { Pencil } from 'lucide-react';
import { Card, CardContent } from '../../../components/ui/Card';
import { RISK_CLASSES, AUTH_TYPES, INPUT_CLASS } from './constants';

/**
 * Edit a registered agent's PATCHABLE fields (name, endpoint, auth_type,
 * risk_class, default_budget_usd) and PATCH /api/agents/registry/{id}. Calls
 * onSaved(updatedAgent) so the parent can refresh the master list + detail.
 */
export default function EditPanel({ agent, onSaved, onCancel }) {
  const [form, setForm] = useState({
    name: agent.name || '',
    endpoint: agent.endpoint || '',
    auth_type: agent.auth_type || 'none',
    risk_class: agent.risk_class || 'medium',
    default_budget_usd: agent.default_budget_usd ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setForm({
      name: agent.name || '',
      endpoint: agent.endpoint || '',
      auth_type: agent.auth_type || 'none',
      risk_class: agent.risk_class || 'medium',
      default_budget_usd: agent.default_budget_usd ?? '',
    });
    setError(null);
  }, [agent.entry_id, agent.name, agent.endpoint, agent.auth_type, agent.risk_class, agent.default_budget_usd]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const patch = { ...form };
      if (patch.default_budget_usd === '') patch.default_budget_usd = null;
      else patch.default_budget_usd = Number(patch.default_budget_usd);
      const res = await fetch(`/api/agents/registry/${agent.entry_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || 'Failed to update agent'); return; }
      onSaved?.(json.registered_agent);
    } catch {
      setError('Failed to update agent');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-border px-5 py-3 text-sm font-semibold text-white">
        <Pencil size={14} className="text-brand" aria-hidden="true" /> Edit agent
      </div>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-secondary">Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT_CLASS} />
          </label>
          <label className="text-xs text-secondary">Endpoint
            <input value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
              placeholder="https://provider.example.com" className={INPUT_CLASS} />
          </label>
          <label className="text-xs text-secondary">Auth type
            <select value={form.auth_type} onChange={(e) => setForm({ ...form, auth_type: e.target.value })} className={INPUT_CLASS}>
              {AUTH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-xs text-secondary">Risk class
            <select value={form.risk_class} onChange={(e) => setForm({ ...form, risk_class: e.target.value })} className={INPUT_CLASS}>
              {RISK_CLASSES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="text-xs text-secondary">Default budget (USD)
            <input type="number" value={form.default_budget_usd}
              onChange={(e) => setForm({ ...form, default_budget_usd: e.target.value })} className={INPUT_CLASS} />
          </label>
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-error">{error}</p>}
        <div className="mt-3 flex items-center gap-2">
          <button onClick={handleSave} disabled={saving || !form.name.trim()}
            className="rounded-lg border border-brand/20 bg-brand/10 px-4 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button onClick={onCancel}
            className="rounded-lg border border-border px-4 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white">
            Cancel
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
