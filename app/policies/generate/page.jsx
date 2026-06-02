'use client';

import { useMemo, useState } from 'react';
import {
  buildPolicySummary,
  compilePolicyPayload,
  POLICY_TYPE_OPTIONS as POLICY_TYPES,
} from '../lib/policyFormModel.js';
import { normalizeGeneratedPolicyDrafts } from './lib/policyGeneratorDrafts.js';
import PolicyDraftCandidateList from './components/PolicyDraftCandidateList';
import PolicyGeneratedDraftEditor from './components/PolicyGeneratedDraftEditor';

const ACTION_OPTIONS = [
  'build', 'deploy', 'post', 'apply', 'security', 'message', 'api',
  'calendar', 'research', 'review', 'fix', 'refactor', 'test', 'config',
  'monitor', 'alert', 'cleanup', 'sync', 'migrate', 'other',
];

function cloneFormState(formState) {
  return JSON.parse(JSON.stringify(formState));
}

function isWebhookConfigInvalid(form) {
  if (form.type !== 'webhook_check') return false;
  try {
    const url = new URL(form.webhookUrl);
    return url.protocol !== 'https:' || !url.hostname;
  } catch {
    return true;
  }
}

function isAuthoringFormInvalid(form) {
  if (!form?.name?.trim()) return true;
  if ((form.type === 'require_approval' || form.type === 'block_action_type') && form.actionTypes.length === 0) return true;
  if (isWebhookConfigInvalid(form)) return true;
  if (form.type === 'semantic_check' && !form.instruction.trim()) return true;
  return false;
}

export default function PolicyGeneratePage() {
  const [inputText, setInputText] = useState('');
  const [drafts, setDrafts] = useState([]);
  const [selectedDraftId, setSelectedDraftId] = useState(null);
  const [draftForm, setDraftForm] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.id === selectedDraftId) || null,
    [drafts, selectedDraftId]
  );

  const summary = useMemo(
    () => (draftForm ? buildPolicySummary(draftForm) : ''),
    [draftForm]
  );

  function loadDraft(draft) {
    setSelectedDraftId(draft.id);
    setDraftForm(cloneFormState(draft.formState));
  }

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    setWarnings([]);
    setDrafts([]);
    setSelectedDraftId(null);
    setDraftForm(null);

    try {
      const res = await fetch('/api/policies/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input_text: inputText, dry_run: true }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to generate policy drafts');
        return;
      }

      const normalizedDrafts = normalizeGeneratedPolicyDrafts(data.generated_policies);
      if (normalizedDrafts.length === 0) {
        setError('DashClaw could not generate a policy draft from that input. Try being more specific about the action, risk, or approval rule you want.');
        return;
      }

      setDrafts(normalizedDrafts);
      setWarnings(data.warnings || []);
      loadDraft(normalizedDrafts[0]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!draftForm) return;
    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = compilePolicyPayload(draftForm);
      const res = await fetch('/api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to create policy');
        return;
      }

      setSuccess(`Created policy "${payload.name}"`);
      setInputText('');
      setDrafts([]);
      setSelectedDraftId(null);
      setDraftForm(null);
      setWarnings([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <h1 className="mb-2 text-2xl font-bold text-white">AI Policy Generator</h1>
        <p className="text-secondary">
          Describe what you want DashClaw to prevent or enforce, then review the generated draft in the guided policy editor before saving it.
        </p>
      </div>

      {success && (
        <div className="mb-4 rounded border border-green-700 bg-green-900/30 p-3 text-success">
          {success}{' '}
          <a href="/policies" className="text-green-200 underline hover:text-white">
            View policies
          </a>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded border border-red-700 bg-red-900/30 p-3 text-error">
          {error}
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-5">
        <label className="mb-2 block text-sm font-medium text-white">Policy request</label>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Paste your company policy, Slack message, or compliance requirement..."
          rows={6}
          maxLength={5000}
          className="w-full resize-y rounded-lg border border-zinc-700 bg-tertiary p-3 text-white outline-none placeholder-zinc-500 focus:border-active focus:ring-1 focus:ring-orange-500"
        />
        <div className="mt-1 text-right text-xs text-tertiary">
          {inputText.length}/5000
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading || !inputText.trim()}
          className="mt-4 rounded bg-orange-600 px-4 py-2 font-medium text-white transition-colors hover:bg-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Generating...' : 'Generate Drafts'}
        </button>
      </div>

      {warnings.length > 0 && (
        <div className="mb-6 rounded-xl border border-yellow-500/20 bg-status-warning/10 px-4 py-3 text-sm text-warning">
          {warnings.length === 1 ? warnings[0] : `${warnings.length} generation warnings were returned.`}
        </div>
      )}

      {drafts.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <PolicyDraftCandidateList
            drafts={drafts}
            selectedDraftId={selectedDraftId}
            onSelectDraft={(draftId) => {
              const draft = drafts.find((candidate) => candidate.id === draftId);
              if (draft) loadDraft(draft);
            }}
          />

          <PolicyGeneratedDraftEditor
            draft={selectedDraft}
            form={draftForm}
            setForm={setDraftForm}
            policyTypes={POLICY_TYPES}
            actionOptions={ACTION_OPTIONS}
            agents={[]}
            summary={summary}
            saving={creating}
            onSave={handleCreate}
            saveDisabled={isAuthoringFormInvalid(draftForm || {})}
          />
        </div>
      )}
    </div>
  );
}
