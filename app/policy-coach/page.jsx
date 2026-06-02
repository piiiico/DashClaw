'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ShieldAlert, Lock, RotateCw, AlertTriangle, Cpu, CheckCircle2,
  PlayCircle, Pencil, ThumbsDown, Activity, Sparkles, Database,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { useAgentFilter } from '../lib/AgentFilterContext';

const TYPE_META = {
  destructive_command_approval: { label: 'Destructive commands → approval', icon: ShieldAlert },
  protected_path_approval: { label: 'Protected paths → approval', icon: Lock },
  repeated_reload_warn: { label: 'Repeated file reloads', icon: RotateCw },
  failed_loop_warn: { label: 'Repeated command failures', icon: AlertTriangle },
  model_task_mismatch_warn: { label: 'Cheap model on heavy task', icon: Cpu },
  agent_allowlist: { label: 'Safe operating envelope', icon: CheckCircle2 },
};

const SEV_VARIANT = { high: 'warning', medium: 'info', low: 'default' };
const FP_VARIANT = { low: 'success', medium: 'warning', high: 'error' };

function confidenceTone(c) {
  if (c >= 80) return 'text-success';
  if (c >= 60) return 'text-warning';
  return 'text-secondary';
}

function fmtTs(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

const primaryBtn = 'px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5';
const secondaryBtn = 'px-3 py-1.5 text-xs font-medium text-secondary hover:text-white bg-surface-tertiary border border-border rounded-lg hover:border-border-hover transition-colors inline-flex items-center gap-1.5 disabled:opacity-40';

export default function PolicyCoachPage() {
  const { agentId } = useAgentFilter();
  const [status, setStatus] = useState(null);
  const [agents, setAgents] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [sampleCount, setSampleCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [sims, setSims] = useState({}); // suggestion id -> simulation result
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [dismissing, setDismissing] = useState(null); // suggestion being dismissed
  const [dismissReason, setDismissReason] = useState('');
  const [suppressSimilar, setSuppressSimilar] = useState(false);
  const [editing, setEditing] = useState(null); // suggestion being edited
  const [editForm, setEditForm] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (agentId) params.set('agent_id', agentId);
      const [statusRes, sugRes] = await Promise.all([
        fetch('/api/behavior/samples'),
        fetch(`/api/behavior/suggestions?${params.toString()}`),
      ]);
      const statusData = await statusRes.json();
      const sugData = await sugRes.json();
      if (statusData && !statusData.error) setStatus(statusData);
      if (sugData && !sugData.error) {
        setAgents(Array.isArray(sugData.agents) ? sugData.agents : []);
        setSuggestions(Array.isArray(sugData.suggestions) ? sugData.suggestions : []);
        setSampleCount(sugData.sample_count || 0);
      } else if (sugData && sugData.error) {
        setError(sugData.error);
      }
    } catch (err) {
      setError('Failed to load Policy Coach data.');
      console.error('[policy-coach] fetch error', err);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const runSimulation = useCallback(async (suggestion, editedRule) => {
    setBusy(suggestion.id);
    setNotice('');
    try {
      const body = editedRule ? { rule: editedRule } : { suggestion_id: suggestion.id };
      const res = await fetch('/api/behavior/simulate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data && data.simulation) {
        setSims((prev) => ({ ...prev, [suggestion.id]: data.simulation }));
      } else {
        setError(data.error || 'Simulation failed.');
      }
      return data.simulation;
    } catch (err) {
      setError('Simulation request failed.');
      console.error('[policy-coach] simulate error', err);
    } finally {
      setBusy('');
    }
  }, []);

  const adopt = useCallback(async (suggestion, edited) => {
    if (!sims[suggestion.id]) {
      setError('Run a simulation and review the impact before adopting.');
      return;
    }
    setBusy(suggestion.id);
    setNotice('');
    try {
      const res = await fetch('/api/behavior/suggestions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'adopt', suggestion_id: suggestion.id, acknowledged_simulation: true, edited: edited || undefined }),
      });
      const data = await res.json();
      if (data && data.adopted) {
        setNotice(data.note || (data.advisory ? 'Observation accepted.' : 'Draft policy created (inactive).'));
        setEditing(null);
        await fetchData();
      } else {
        setError(data.error || 'Adoption failed.');
      }
    } catch (err) {
      setError('Adoption request failed.');
      console.error('[policy-coach] adopt error', err);
    } finally {
      setBusy('');
    }
  }, [sims, fetchData]);

  const submitDismiss = useCallback(async () => {
    if (!dismissing) return;
    setBusy(dismissing.id);
    try {
      const res = await fetch('/api/behavior/suggestions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss', suggestion_id: dismissing.id, reason: dismissReason || null, suppress_similar: suppressSimilar }),
      });
      const data = await res.json();
      if (data && data.dismissed) {
        setDismissing(null);
        setDismissReason('');
        setSuppressSimilar(false);
        await fetchData();
      } else {
        setError(data.error || 'Dismiss failed.');
      }
    } catch (err) {
      setError('Dismiss request failed.');
    } finally {
      setBusy('');
    }
  }, [dismissing, dismissReason, suppressSimilar, fetchData]);

  const openEdit = (s) => {
    const rules = s.draft_policy ? JSON.parse(s.draft_policy.rules) : {};
    setEditForm({
      action: rules.action || s.rule.action || 'require_approval',
      risk_threshold: rules.threshold ?? s.rule.risk_threshold ?? 70,
      paths: Array.isArray(rules.paths) ? rules.paths.join('\n') : '',
    });
    setEditing(s);
  };

  const editedRuleFromForm = (s) => {
    if (s.type === 'protected_path_approval') {
      return { ...s.rule, action: editForm.action, paths: editForm.paths.split('\n').map((p) => p.trim()).filter(Boolean) };
    }
    return { ...s.rule, action: editForm.action, risk_threshold: Number(editForm.risk_threshold) };
  };

  const ready = status?.ready;

  return (
    <PageLayout
      title="Policy Coach"
      subtitle="Evidence-backed policy suggestions learned from real, locally-recorded agent behavior. Observe-only — nothing is enforced until you activate it."
      breadcrumbs={['Governance', 'Policy Coach']}
      maturity="beta"
    >
      {/* Status / privacy strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Samples captured" value={status?.sample_count ?? sampleCount ?? 0} icon={Database} />
        <StatTile label="Observed agents" value={status?.agent_count ?? agents.length} icon={Activity} />
        <StatTile label="Suggestions" value={suggestions.length} icon={Sparkles} />
        <StatTile label="Recorder" value={status?.recorder_enabled ? 'On' : 'Off'} tone={status?.recorder_enabled ? 'text-success' : 'text-tertiary'} icon={CheckCircle2} />
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-success/20 bg-success-subtle px-4 py-2.5 text-xs text-success">{notice}</div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-error/20 bg-error-subtle px-4 py-2.5 text-xs text-error">{error}</div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-tertiary">Analyzing local samples…</div>
      ) : sampleCount === 0 ? (
        <Card hover={false}>
          <CardContent className="pt-5">
            <EmptyState
              icon={Database}
              title="No behavior samples yet"
              description="Enable the passive recorder to capture redacted, local-only samples of your Claude Code / agent usage. Set DASHCLAW_BEHAVIOR_SAMPLES_ENABLED=1 in your hook environment, then run agents normally. Samples are written to .dashclaw/behavior-samples/ and never leave your machine."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Suggestions (main column) */}
          <div className="lg:col-span-2">
            <Card hover={false}>
              <CardHeader title="Policy suggestions" icon={Sparkles} count={suggestions.length} />
              <CardContent className="pt-0">
                {suggestions.length === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    title={ready ? 'No suggestions right now' : 'Not enough samples yet'}
                    description={ready
                      ? 'DashClaw found no evidence-backed policy suggestions for the observed agents. Keep working — new patterns surface as behavior accumulates.'
                      : `Capture at least ${status?.min_samples ?? 8} samples for an agent before suggestions appear.`}
                  />
                ) : (
                  <div className="space-y-3">
                    {suggestions.map((s) => (
                      <SuggestionCard
                        key={s.id}
                        s={s}
                        sim={sims[s.id]}
                        busy={busy === s.id}
                        onSimulate={() => runSimulation(s)}
                        onAdopt={() => adopt(s)}
                        onEdit={() => openEdit(s)}
                        onDismiss={() => { setDismissing(s); setDismissReason(''); setSuppressSimilar(false); }}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Observed agents (side column) */}
          <div>
            <Card hover={false}>
              <CardHeader title="Observed agents" icon={Activity} count={agents.length} />
              <CardContent className="pt-0">
                {agents.length === 0 ? (
                  <div className="py-6 text-center text-xs text-tertiary">No agents observed.</div>
                ) : (
                  <div className="space-y-3">
                    {agents.map((a) => <AgentEnvelope key={a.agent_id} a={a} />)}
                  </div>
                )}
              </CardContent>
            </Card>
            <p className="mt-3 px-1 text-[11px] leading-relaxed text-tertiary">
              Samples are stored locally at <span className="font-mono text-secondary">{status?.dir || '.dashclaw/behavior-samples'}</span> and analyzed on this machine. Adopted suggestions become inactive drafts on{' '}
              <Link href="/policies" className="text-secondary hover:text-brand">Policies</Link> — never enforced automatically.
            </p>
          </div>
        </div>
      )}

      {dismissing && (
        <Modal onClose={() => setDismissing(null)} title="Dismiss suggestion">
          <p className="mb-3 text-xs text-tertiary">{TYPE_META[dismissing.type]?.label} for <span className="text-secondary">{dismissing.agent_id}</span></p>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-tertiary">Reason (optional)</label>
          <textarea
            value={dismissReason}
            onChange={(e) => setDismissReason(e.target.value)}
            rows={2}
            className="mb-3 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
            placeholder="e.g. false positive — this agent is allowed to do this"
          />
          <label className="mb-4 flex items-center gap-2 text-xs text-secondary">
            <input type="checkbox" checked={suppressSimilar} onChange={(e) => setSuppressSimilar(e.target.checked)} className="accent-[color:var(--color-brand)]" />
            Suppress similar suggestions of this type for this agent
          </label>
          <div className="flex justify-end gap-2">
            <button className={secondaryBtn} onClick={() => setDismissing(null)}>Cancel</button>
            <button className={primaryBtn} disabled={busy === dismissing.id} onClick={submitDismiss}>Dismiss</button>
          </div>
        </Modal>
      )}

      {editing && editForm && (
        <Modal onClose={() => setEditing(null)} title="Edit draft policy">
          <p className="mb-3 text-xs text-tertiary">{TYPE_META[editing.type]?.label} for <span className="text-secondary">{editing.agent_id}</span></p>
          {editing.type === 'protected_path_approval' ? (
            <>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-tertiary">Protected path globs (one per line)</label>
              <textarea
                value={editForm.paths}
                onChange={(e) => setEditForm({ ...editForm, paths: e.target.value })}
                rows={5}
                className="mb-3 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 font-mono text-xs text-white focus:border-brand focus:outline-none"
              />
            </>
          ) : (
            <>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-tertiary">Risk threshold (0–100)</label>
              <input
                type="number" min={0} max={100}
                value={editForm.risk_threshold}
                onChange={(e) => setEditForm({ ...editForm, risk_threshold: e.target.value })}
                className="mb-3 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
              />
            </>
          )}
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-tertiary">Decision</label>
          <select
            value={editForm.action}
            onChange={(e) => setEditForm({ ...editForm, action: e.target.value })}
            className="mb-4 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
          >
            <option value="warn">Warn</option>
            <option value="require_approval">Require approval</option>
            <option value="block">Block</option>
          </select>
          {sims[editing.id] && <SimGrid sim={sims[editing.id]} />}
          <div className="mt-4 flex justify-end gap-2">
            <button className={secondaryBtn} disabled={busy === editing.id} onClick={() => runSimulation(editing, editedRuleFromForm(editing))}>
              <PlayCircle size={13} /> Simulate edit
            </button>
            <button className={primaryBtn} disabled={busy === editing.id || !sims[editing.id]} onClick={() => adopt(editing, editedRuleFromForm(editing))}>
              Adopt edited draft
            </button>
          </div>
        </Modal>
      )}
    </PageLayout>
  );
}

function StatTile({ label, value, icon: Icon, tone }) {
  return (
    <div className="rounded-xl border border-border bg-surface-secondary px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-tertiary">
        {Icon && <Icon size={12} />} {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone || 'text-white'}`}>{value}</div>
    </div>
  );
}

function SimGrid({ sim }) {
  const cells = [
    { label: 'Allow', value: sim.allow, tone: 'text-success' },
    { label: 'Warn', value: sim.warn, tone: 'text-warning' },
    { label: 'Approval', value: sim.require_approval, tone: 'text-warning' },
    { label: 'Block', value: sim.block, tone: 'text-error' },
  ];
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-tertiary p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-tertiary">
        <span>Replay over {sim.total} sample{sim.total === 1 ? '' : 's'}</span>
        {sim.likely_false_positives > 0 && (
          <Badge variant="warning" size="xs">{sim.likely_false_positives} likely false positive{sim.likely_false_positives === 1 ? '' : 's'}</Badge>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {cells.map((c) => (
          <div key={c.label} className="text-center">
            <div className={`text-lg font-semibold tabular-nums ${c.tone}`}>{c.value}</div>
            <div className="text-[10px] uppercase tracking-wide text-tertiary">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SuggestionCard({ s, sim, busy, onSimulate, onAdopt, onEdit, onDismiss }) {
  const meta = TYPE_META[s.type] || { label: s.type, icon: Sparkles };
  const Icon = meta.icon;
  return (
    <div className="rounded-lg border border-border bg-surface-tertiary p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon size={15} className="shrink-0 text-secondary" />
            <span className="text-sm font-medium text-white">{meta.label}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-tertiary">{s.agent_id}</span>
            <Badge variant={SEV_VARIANT[s.severity]} size="xs">{s.severity}</Badge>
            <Badge variant={s.enforceable ? 'brand' : 'default'} size="xs">{s.enforceable ? 'enforceable draft' : 'advisory'}</Badge>
            <Badge variant={FP_VARIANT[s.false_positive_risk]} size="xs">FP risk: {s.false_positive_risk}</Badge>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-sm font-semibold tabular-nums ${confidenceTone(s.confidence)}`}>{s.confidence}%</div>
          <div className="text-[10px] uppercase tracking-wide text-tertiary">confidence</div>
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-secondary">{s.expected_effect}</p>

      <div className="mt-2 text-[11px] text-tertiary">
        Evidence: <span className="tabular-nums text-secondary">{s.matching_sample_size}</span> of{' '}
        <span className="tabular-nums text-secondary">{s.sample_size}</span> samples · target{' '}
        <span className="text-secondary">{s.target}</span>
      </div>

      {s.evidence_examples?.length > 0 && (
        <ul className="mt-2 space-y-1">
          {s.evidence_examples.slice(0, 3).map((e) => (
            <li key={e.event_id} className="flex items-center gap-2 font-mono text-[11px] text-tertiary">
              <span className="truncate text-secondary">{e.command_shape || e.write_path || e.tool}</span>
              {e.outcome_status && <span className="shrink-0 text-tertiary">· {e.outcome_status}</span>}
              {e.risk_score != null && <span className="shrink-0 text-tertiary">· risk {e.risk_score}</span>}
            </li>
          ))}
        </ul>
      )}

      {sim && <SimGrid sim={sim} />}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={secondaryBtn} disabled={busy} onClick={onSimulate}>
          <PlayCircle size={13} /> {sim ? 'Re-simulate' : 'Simulate'}
        </button>
        {s.enforceable && (
          <button className={secondaryBtn} disabled={busy} onClick={onEdit}>
            <Pencil size={13} /> Edit
          </button>
        )}
        <button className={primaryBtn} disabled={busy || !sim} title={!sim ? 'Simulate first' : undefined} onClick={onAdopt}>
          {s.advisory ? 'Accept observation' : 'Adopt as draft'}
        </button>
        <button className={secondaryBtn} disabled={busy} onClick={onDismiss}>
          <ThumbsDown size={13} /> Dismiss
        </button>
      </div>
    </div>
  );
}

function AgentEnvelope({ a }) {
  return (
    <div className="rounded-lg border border-border bg-surface-tertiary p-3">
      <div className="flex items-center justify-between">
        <span className="truncate font-mono text-xs text-white">{a.agent_id}</span>
        <span className="tabular-nums text-[11px] text-tertiary">{a.sample_size} samples</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {a.destructive_commands > 0 && <Badge variant="warning" size="xs">{a.destructive_commands} destructive</Badge>}
        {a.protected_touches > 0 && <Badge variant="warning" size="xs">{a.protected_touches} protected writes</Badge>}
        {a.failed > 0 && <Badge variant="error" size="xs">{a.failed} failed</Badge>}
        {a.models?.length > 0 && <Badge variant="default" size="xs">{a.models.length} model{a.models.length === 1 ? '' : 's'}</Badge>}
      </div>
      {a.safe_envelope?.tools?.length > 0 && (
        <div className="mt-2 text-[11px] text-tertiary">
          Safe ops: <span className="text-secondary">{a.safe_envelope.tools.slice(0, 5).join(', ')}</span>
        </div>
      )}
      <div className="mt-1 text-[11px] text-tertiary">Last seen {fmtTs(a.last_ts)}</div>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border-hover bg-surface-secondary p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-sm font-semibold text-white">{title}</h2>
        {children}
      </div>
    </div>
  );
}
