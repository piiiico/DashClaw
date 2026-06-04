'use client';

import { useState, useEffect, useCallback } from 'react';
import { Boxes, Plus, ShieldCheck } from 'lucide-react';
import PageLayout from '../../components/PageLayout';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { ListSkeleton } from '../../components/ui/Skeleton';

const RISK_CLASSES = ['low', 'medium', 'high', 'critical'];
const AUTH_TYPES = ['none', 'bearer', 'api_key'];

const EMPTY_FORM = { name: '', endpoint: '', auth_type: 'none', risk_class: 'medium', default_budget_usd: '' };

function pct(n) {
  return n == null ? '—' : `${Math.round(Number(n) * 100)}%`;
}

export default function AgentRegistryPage() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reputation, setReputation] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/registry');
      if (res.ok) setAgents((await res.json()).registered_agents || []);
    } catch {
      setError('Failed to load registered agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const selectAgent = useCallback(async (agent) => {
    setSelectedId(agent.entry_id);
    setDetail(null);
    setReputation(null);
    try {
      const res = await fetch(`/api/agents/registry/${agent.entry_id}`);
      if (res.ok) setDetail(await res.json());
      // The reputation trust metric from Group B, keyed on the provider's slug.
      const repRes = await fetch(`/api/reputation/agents/${encodeURIComponent(agent.slug)}`);
      if (repRes.ok) setReputation((await repRes.json()).vector);
    } catch { /* surface nothing fatal in the panel */ }
  }, []);

  const handleRegister = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = { ...form };
      if (payload.default_budget_usd === '') delete payload.default_budget_usd;
      else payload.default_budget_usd = Number(payload.default_budget_usd);
      const res = await fetch('/api/agents/registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Failed to register agent'); return; }
      setShowForm(false);
      setForm(EMPTY_FORM);
      await fetchAgents();
    } catch {
      setError('Failed to register agent');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageLayout
      title="Agent Registry"
      subtitle="External, org-owned providers that group capabilities and are invoked through governance"
      breadcrumbs={['Agents', 'Registry']}
      actions={
        <button
          onClick={() => { setShowForm((v) => !v); setError(null); }}
          className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
        >
          <Plus size={12} aria-hidden="true" /> Register agent
        </button>
      }
    >
      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-error/30 bg-error-subtle p-3 text-sm text-error">{error}</div>
      )}

      {showForm && (
        <Card className="mb-6">
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-secondary">Name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-white focus:border-brand/50 focus:outline-none" />
              </label>
              <label className="text-xs text-secondary">Endpoint
                <input value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} placeholder="https://provider.example.com"
                  className="mt-1 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-white focus:border-brand/50 focus:outline-none" />
              </label>
              <label className="text-xs text-secondary">Auth type
                <select value={form.auth_type} onChange={(e) => setForm({ ...form, auth_type: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-white focus:border-brand/50 focus:outline-none">
                  {AUTH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="text-xs text-secondary">Risk class
                <select value={form.risk_class} onChange={(e) => setForm({ ...form, risk_class: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-white focus:border-brand/50 focus:outline-none">
                  {RISK_CLASSES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="text-xs text-secondary">Default budget (USD)
                <input type="number" value={form.default_budget_usd} onChange={(e) => setForm({ ...form, default_budget_usd: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-white focus:border-brand/50 focus:outline-none" />
              </label>
            </div>
            <button onClick={handleRegister} disabled={saving || !form.name.trim()}
              className="mt-3 rounded-lg border border-brand/20 bg-brand/10 px-4 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50">
              {saving ? 'Registering…' : 'Register'}
            </button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Card>
            <div className="border-b border-border px-5 py-3 text-sm font-semibold text-white">Registered agents</div>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-5"><ListSkeleton rows={4} /></div>
              ) : agents.length === 0 ? (
                <div className="p-8"><EmptyState icon={Boxes} title="No registered agents" description="Register an external provider to delegate governed work to it." /></div>
              ) : (
                <div className="divide-y divide-border">
                  {agents.map((a) => (
                    <button key={a.entry_id} onClick={() => selectAgent(a)}
                      className={`flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-white/5 ${selectedId === a.entry_id ? 'bg-white/5' : ''}`}>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{a.name}</div>
                        <div className="truncate text-xs text-tertiary">{a.slug}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge size="xs">{a.risk_class}</Badge>
                        <Badge variant={a.status === 'active' ? 'success' : 'default'} size="xs">{a.status}</Badge>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-3">
          {!detail ? (
            <Card><CardContent><EmptyState icon={Boxes} title="Select an agent" description="Choose a registered agent to view its capabilities, reputation, and invocation history." /></CardContent></Card>
          ) : (
            <div className="space-y-6">
              {/* Reputation trust metric (Group B) */}
              <Card>
                <div className="flex items-center gap-2 border-b border-border px-5 py-3 text-sm font-semibold text-white">
                  <ShieldCheck size={14} className="text-brand" aria-hidden="true" /> Reputation
                </div>
                <CardContent>
                  {!reputation ? (
                    <p className="text-xs text-tertiary">No reputation data yet for this provider.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Metric label="Reliability" value={pct(reputation.reliability_score)} />
                      <Metric label="Completion" value={pct(reputation.completion_rate)} />
                      <Metric label="Confidence" value={pct(reputation.confidence)} />
                      <Metric label="Risk" value={reputation.risk_score == null ? '—' : String(reputation.risk_score)} />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <div className="border-b border-border px-5 py-3 text-sm font-semibold text-white">Capabilities</div>
                <CardContent>
                  {(detail.capabilities || []).length === 0 ? (
                    <p className="text-xs text-tertiary">No capabilities grouped under this agent yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {detail.capabilities.map((c) => (
                        <li key={c.capability_id} className="flex items-center justify-between text-xs">
                          <span className="text-secondary">{c.name}</span>
                          <Badge size="xs">{c.risk_level}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <div className="border-b border-border px-5 py-3 text-sm font-semibold text-white">Invocation history</div>
                <CardContent>
                  {(detail.invocations || []).length === 0 ? (
                    <p className="text-xs text-tertiary">No invocations recorded yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {detail.invocations.map((inv) => (
                        <li key={inv.id} className="flex items-center justify-between text-[11px] text-tertiary">
                          <span className="font-mono text-secondary">{inv.action_id || inv.id}</span>
                          <span>{inv.created_at}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-border bg-surface-tertiary p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-white">{value}</div>
    </div>
  );
}
