'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Upload, Sparkles, Trash2, Play, Copy, Check, Pencil,
  ToggleLeft, ToggleRight, X, FlaskConical, ShieldCheck,
} from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import PolicyAuthoringPanel from './PolicyAuthoringPanel';
import PolicyAdvancedImportPanel from './PolicyAdvancedImportPanel';
import ProofExportPanel from './ProofExportPanel';
import {
  createDefaultPolicyFormState,
  compilePolicyPayload,
  decompilePolicyForm,
  buildPolicySummary,
  POLICY_TYPE_OPTIONS as POLICY_TYPES,
} from '../lib/policyFormModel';
import { PACK_PREVIEWS } from '../../lib/policyPackPreviews.js';

const ACTION_OPTIONS = [
  'build', 'deploy', 'post', 'apply', 'security', 'message', 'api',
  'calendar', 'research', 'review', 'fix', 'refactor', 'test', 'config',
  'monitor', 'alert', 'cleanup', 'sync', 'migrate', 'other',
];

function formatRules(policy) {
  const type = policy.policy_type;
  let rules;
  try { rules = JSON.parse(policy.rules || '{}'); } catch { return type; }
  switch (type) {
    case 'risk_threshold': return `Risk >= ${rules.threshold} \u2192 ${rules.action || 'block'}`;
    case 'require_approval': return `${(rules.action_types || []).join(', ')} \u2192 require approval`;
    case 'block_action_type': return `${(rules.action_types || []).join(', ')} \u2192 block`;
    case 'rate_limit': return `Max ${rules.max_actions} / ${rules.window_minutes}min \u2192 ${rules.action || 'warn'}`;
    case 'webhook_check': { try { return `Webhook \u2192 ${new URL(rules.url).hostname}`; } catch { return 'Webhook'; } }
    case 'semantic_check': return `Semantic: "${(rules.instruction || '').slice(0, 50)}..."`;
    case 'non_fabrication': return `Non-fabrication → ${rules.on_violation || 'block'}`;
    case 'behavioral_anomaly': return `Anomaly < ${Math.round((rules.similarity_threshold ?? 0.75) * 100)}% similar → ${rules.action || 'require_approval'}`;
    case 'permission_escalation': return rules.enforce ? `Permission escalation → ${rules.action || 'block'}` : 'Permission escalation (disabled)';
    case 'green_contract': return `${(rules.action_types || []).join(', ')} need ${rules.required_level || 'workspace'} green → ${rules.action || 'block'}`;
    case 'branch_freshness': return `${(rules.action_types || []).join(', ')} when ${(rules.freshness || ['stale', 'diverged']).join('/')} → ${rules.action || 'block'}`;
    default: return type;
  }
}

function parseAgentIds(policy) {
  if (!policy.agent_ids) return [];
  try { const p = JSON.parse(policy.agent_ids); return Array.isArray(p) ? p : []; } catch { return []; }
}

export default function CustomTab() {
  const [policies, setPolicies] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterActive, setFilterActive] = useState('');

  // Authoring form state
  const [showAuthoring, setShowAuthoring] = useState(false);
  const [authoringForm, setAuthoringForm] = useState(createDefaultPolicyFormState());
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [authoringError, setAuthoringError] = useState(null);

  // Import panel state
  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState('pack');
  const [importPack, setImportPack] = useState('enterprise-strict');
  const [importYaml, setImportYaml] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [templates, setTemplates] = useState([]);

  // Proof report + test runner state
  const [showProof, setShowProof] = useState(false);
  const [showTests, setShowTests] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testResults, setTestResults] = useState(null);

  // AI Generator state
  const [showGenerator, setShowGenerator] = useState(false);
  const [genInput, setGenInput] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState(null);
  const [genSuccess, setGenSuccess] = useState(null);

  // Row actions
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const fetchPolicies = useCallback(async () => {
    try {
      const [policiesRes, agentsRes] = await Promise.all([
        fetch('/api/policies'),
        fetch('/api/agents'),
      ]);
      if (policiesRes.ok) {
        const data = await policiesRes.json();
        setPolicies(data.policies || []);
      }
      if (agentsRes.ok) {
        const data = await agentsRes.json();
        setAgents(data.agents || []);
      }
    } catch (err) {
      console.error('Failed to fetch policies:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

  useEffect(() => {
    fetch('/api/policies/templates')
      .then(r => (r.ok ? r.json() : { templates: [] }))
      .then(d => setTemplates(d.templates || []))
      .catch(() => { /* fall back to static previews */ });
  }, []);

  const filtered = policies.filter(p => {
    if (search && !p.name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterType && p.policy_type !== filterType) return false;
    if (filterActive === 'active' && p.active !== 1) return false;
    if (filterActive === 'inactive' && p.active !== 0) return false;
    return true;
  });

  // Authoring actions
  const openCreate = () => {
    setEditingId(null);
    setAuthoringForm(createDefaultPolicyFormState());
    setAuthoringError(null);
    setShowAuthoring(true);
    setShowImport(false);
  };

  const openEdit = (policy) => {
    setEditingId(policy.id);
    setAuthoringForm(decompilePolicyForm(policy));
    setAuthoringError(null);
    setShowAuthoring(true);
    setShowImport(false);
  };

  const closeAuthoring = () => {
    setShowAuthoring(false);
    setEditingId(null);
    setAuthoringForm(createDefaultPolicyFormState());
    setAuthoringError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setAuthoringError(null);
    try {
      const payload = compilePolicyPayload(authoringForm);
      const isEdit = Boolean(editingId);
      const res = await fetch('/api/policies', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: editingId, ...payload } : payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setAuthoringError(json.error || 'Failed to save policy');
      } else {
        closeAuthoring();
        await fetchPolicies();
      }
    } catch {
      setAuthoringError('Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  // Import actions
  const openImport = () => {
    setImportResult(null);
    setShowImport(true);
    setShowAuthoring(false);
  };

  const closeImport = () => {
    setShowImport(false);
    setImportResult(null);
  };

  const handleImport = async () => {
    setImporting(true);
    setImportResult(null);
    try {
      const body = importMode === 'pack' ? { pack: importPack } : { yaml: importYaml };
      const res = await fetch('/api/policies/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok) {
        setImportResult(json);
        await fetchPolicies();
      } else {
        setImportResult({ error: json.error || 'Import failed' });
      }
    } catch {
      setImportResult({ error: 'Import failed' });
    } finally {
      setImporting(false);
    }
  };

  // Row actions
  const handleDelete = async (id) => {
    setDeleting(true);
    try {
      await fetch(`/api/policies?id=${id}`, { method: 'DELETE' });
      await fetchPolicies();
    } catch { /* ignore */ } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  const handleToggleActive = async (policy) => {
    await fetch('/api/policies', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: policy.id, active: policy.active === 1 ? 0 : 1 }),
    });
    await fetchPolicies();
  };

  const handleExport = async (policy) => {
    const json = JSON.stringify(
      { name: policy.name, policy_type: policy.policy_type, rules: policy.rules, agent_ids: policy.agent_ids },
      null,
      2,
    );
    await navigator.clipboard.writeText(json);
    setCopiedId(policy.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleSimulate = async (policy) => {
    let rules;
    try { rules = JSON.parse(policy.rules); } catch { return; }
    const res = await fetch('/api/policies/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy_type: policy.policy_type, rules, days: 7 }),
    });
    if (res.ok) {
      const data = await res.json();
      const s = data.summary || {};
      alert(`Simulation (7d): ${s.matches || 0} matches \u2014 ${s.block || 0} blocks, ${s.warn || 0} warns, ${s.require_approval || 0} approvals`);
    }
  };

  const handleGenerate = async () => {
    setGenLoading(true);
    setGenError(null);
    setGenSuccess(null);
    try {
      const res = await fetch('/api/policies/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input_text: genInput, dry_run: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenError(data.error || 'Failed to generate policies');
        return;
      }
      const count = data.created_policies?.length || 0;
      setGenSuccess(`Created ${count} ${count === 1 ? 'policy' : 'policies'} from your description.`);
      setGenInput('');
      fetchPolicies();
    } catch (err) {
      setGenError(err.message);
    } finally {
      setGenLoading(false);
    }
  };

  const handleRunTests = async () => {
    setShowTests(true);
    setTestRunning(true);
    setTestResults(null);
    setShowProof(false);
    try {
      const res = await fetch('/api/policies/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setTestResults(res.ok ? data.results : { error: data.error || 'Failed to run tests' });
    } catch {
      setTestResults({ error: 'Failed to run tests' });
    } finally {
      setTestRunning(false);
    }
  };

  const openProof = () => {
    setShowProof(true);
    setShowTests(false);
    setShowGenerator(false);
    setShowAuthoring(false);
  };

  const summary = buildPolicySummary(authoringForm);
  const isFormInvalid = !authoringForm.name?.trim();

  return (
    <div className="space-y-4">
      {/* Actions bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
        >
          <Plus size={12} aria-hidden="true" /> New policy
        </button>
        <button
          onClick={openImport}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
        >
          <Upload size={12} aria-hidden="true" /> Import
        </button>
        <button
          onClick={() => { setShowGenerator(!showGenerator); setShowAuthoring(false); setShowImport(false); }}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
        >
          <Sparkles size={12} aria-hidden="true" /> AI generator
        </button>
        <button
          onClick={handleRunTests}
          disabled={testRunning}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white disabled:opacity-50"
        >
          <FlaskConical size={12} aria-hidden="true" /> {testRunning ? 'Running…' : 'Run tests'}
        </button>
        <button
          onClick={openProof}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
        >
          <ShieldCheck size={12} aria-hidden="true" /> Export proof
        </button>
      </div>

      {/* Proof report panel */}
      <ProofExportPanel open={showProof} onClose={() => setShowProof(false)} />

      {/* Test runner results */}
      {showTests && (
        <div className="space-y-3 rounded-xl border border-border bg-surface-secondary p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FlaskConical size={14} className="text-brand" aria-hidden="true" />
              <span className="text-sm font-semibold text-white">Guardrail test results</span>
            </div>
            <button
              onClick={() => setShowTests(false)}
              className="text-tertiary transition-colors hover:text-white"
              aria-label="Close test results"
            >
              <X size={16} />
            </button>
          </div>
          {testRunning && <p className="text-xs text-secondary">Running policy tests…</p>}
          {testResults?.error && (
            <div className="rounded-lg border border-error/30 bg-error-subtle px-3 py-2 text-xs text-error">{testResults.error}</div>
          )}
          {testResults && !testResults.error && (
            <>
              <div className="flex items-center gap-2">
                <Badge variant={testResults.success ? 'success' : 'error'} size="xs">
                  {`${testResults.passed}/${testResults.total_tests} passed`}
                </Badge>
                <span className="text-xs text-tertiary">{testResults.total_policies} policies</span>
              </div>
              {testResults.total_tests === 0 ? (
                <p className="text-xs text-tertiary">No active policies to test.</p>
              ) : (
                <div className="space-y-2">
                  {testResults.details.map(d => (
                    <div key={d.policy_id} className="rounded-lg border border-border bg-surface-tertiary p-3">
                      <div className="text-xs font-medium text-white">{d.policy_name}</div>
                      <div className="mt-1.5 space-y-1">
                        {d.tests.map((t, i) => (
                          <div key={i} className="flex items-center gap-2 text-[11px]">
                            {t.passed
                              ? <Check size={11} className="text-success" aria-hidden="true" />
                              : <X size={11} className="text-error" aria-hidden="true" />}
                            <span className="text-secondary">{t.name}</span>
                            {!t.passed && t.reason && <span className="text-tertiary">— {t.reason}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* AI Generator panel */}
      {showGenerator && (
        <div className="space-y-3 rounded-xl border border-border bg-surface-secondary p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-brand" aria-hidden="true" />
              <span className="text-sm font-semibold text-white">AI policy generator</span>
            </div>
            <button
              onClick={() => { setShowGenerator(false); setGenError(null); setGenSuccess(null); }}
              className="text-tertiary transition-colors hover:text-white"
              aria-label="Close AI generator"
            >
              <X size={16} />
            </button>
          </div>
          <p className="text-xs text-secondary">Describe what you want DashClaw to prevent or enforce in plain English.</p>
          {genSuccess && <div className="rounded-lg border border-success/30 bg-success-subtle px-3 py-2 text-xs text-success">{genSuccess}</div>}
          {genError && <div className="rounded-lg border border-error/30 bg-error-subtle px-3 py-2 text-xs text-error">{genError}</div>}
          <textarea
            value={genInput}
            onChange={e => setGenInput(e.target.value)}
            placeholder="e.g. Require approval before any agent can deploy to production or send external messages"
            rows={3}
            maxLength={5000}
            className="w-full resize-none rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-xs text-secondary placeholder:text-disabled transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] tabular-nums text-tertiary">{genInput.length}/5000</span>
            <button
              onClick={handleGenerate}
              disabled={genLoading || !genInput.trim()}
              className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
            >
              <Sparkles size={12} aria-hidden="true" />
              {genLoading ? 'Generating…' : 'Generate & create'}
            </button>
          </div>
        </div>
      )}

      {/* Authoring panel — inline controlled form */}
      {showAuthoring && (
        <div className="space-y-4 rounded-xl border border-brand/20 bg-surface-secondary p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white">
              {editingId ? 'Edit policy' : 'New policy'}
            </div>
            <button
              onClick={closeAuthoring}
              className="text-tertiary transition-colors hover:text-white"
              aria-label="Close policy editor"
            >
              <X size={16} />
            </button>
          </div>

          <PolicyAuthoringPanel
            form={authoringForm}
            policyTypes={POLICY_TYPES}
            actionOptions={ACTION_OPTIONS}
            agents={agents}
            summary={summary}
            onChange={setAuthoringForm}
          />

          {authoringError && (
            <div className="text-xs text-error">{authoringError}</div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || isFormInvalid}
              className="rounded-lg border border-brand/20 bg-brand/10 px-4 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
            >
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create policy'}
            </button>
            <button
              onClick={closeAuthoring}
              className="rounded-lg border border-border bg-surface-tertiary px-4 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Import panel */}
      <PolicyAdvancedImportPanel
        open={showImport}
        onClose={closeImport}
        importMode={importMode}
        setImportMode={setImportMode}
        importPack={importPack}
        setImportPack={setImportPack}
        importYaml={importYaml}
        setImportYaml={setImportYaml}
        importing={importing}
        importResult={importResult}
        handleImport={handleImport}
        packPreviews={PACK_PREVIEWS}
        templates={templates}
      />

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="policy-search" className="sr-only">Search policies</label>
        <input
          id="policy-search"
          type="text"
          placeholder="Search policies…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="min-w-[200px] flex-1 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary placeholder:text-disabled transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <label htmlFor="policy-type-filter" className="sr-only">Filter by type</label>
        <select
          id="policy-type-filter"
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="rounded-lg border border-border bg-surface-tertiary px-2.5 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          <option value="">All types</option>
          <option value="risk_threshold">Risk threshold</option>
          <option value="require_approval">Require approval</option>
          <option value="block_action_type">Block action type</option>
          <option value="rate_limit">Rate limit</option>
          <option value="webhook_check">Webhook check</option>
          <option value="semantic_check">Semantic check</option>
          <option value="non_fabrication">Non-fabrication</option>
        </select>
        <label htmlFor="policy-status-filter" className="sr-only">Filter by status</label>
        <select
          id="policy-status-filter"
          value={filterActive}
          onChange={e => setFilterActive(e.target.value)}
          className="rounded-lg border border-border bg-surface-tertiary px-2.5 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Policy list */}
      <div className="rounded-xl border border-border bg-surface-secondary">
        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12">
            <EmptyState
              icon={Plus}
              title="No policies"
              description="Create your first policy or import a template pack."
            />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(p => {
              const agentCount = parseAgentIds(p).length;
              const isActive = p.active === 1;
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-white">{p.name}</span>
                      <Badge size="xs">{p.policy_type}</Badge>
                      <Badge variant={isActive ? 'success' : 'default'} size="xs">
                        {isActive ? 'active' : 'inactive'}
                      </Badge>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-tertiary">
                      {formatRules(p)} <span aria-hidden="true" className="text-zinc-700">&middot;</span> {agentCount === 0 ? 'All agents' : `${agentCount} agents`} <span aria-hidden="true" className="text-zinc-700">&middot;</span> {p.id}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => handleToggleActive(p)}
                      className="rounded p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand/40"
                      aria-label={isActive ? `Deactivate ${p.name}` : `Activate ${p.name}`}
                    >
                      {isActive
                        ? <ToggleRight size={16} className="text-brand" />
                        : <ToggleLeft size={16} />}
                    </button>
                    <button
                      onClick={() => openEdit(p)}
                      className="rounded p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand/40"
                      aria-label={`Edit ${p.name}`}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => handleSimulate(p)}
                      className="rounded p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand/40"
                      aria-label={`Simulate ${p.name}`}
                    >
                      <Play size={13} />
                    </button>
                    <button
                      onClick={() => handleExport(p)}
                      className="rounded p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand/40"
                      aria-label={`Export ${p.name} as JSON`}
                    >
                      {copiedId === p.id
                        ? <Check size={13} className="text-success" />
                        : <Copy size={13} />}
                    </button>
                    {confirmDeleteId === p.id ? (
                      <span className="flex items-center gap-1 pl-1 text-xs">
                        <button
                          onClick={() => handleDelete(p.id)}
                          disabled={deleting}
                          className="rounded px-1.5 py-0.5 text-error transition-colors hover:bg-error-subtle hover:text-error disabled:opacity-50"
                        >
                          {deleting ? '…' : 'Yes'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded px-1.5 py-0.5 text-secondary transition-colors hover:bg-white/5 hover:text-white"
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(p.id)}
                        className="rounded p-1 text-tertiary transition-colors hover:bg-error-subtle hover:text-error focus:outline-none focus:ring-2 focus:ring-red-500/40"
                        aria-label={`Delete ${p.name}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
