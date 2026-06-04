'use client';

import { useState } from 'react';
import {
  getDefaultProviderModel,
  PROVIDER_MODEL_OPTIONS,
  WORKFLOW_AI_PROVIDER_OPTIONS,
} from '../lib/workflowAiModelCatalog.js';

const inputClass = 'w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand';
const labelClass = 'block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5';

export default function WorkflowAiDraftPanel({
  loading = false,
  error = null,
  onGenerate,
}) {
  const [description, setDescription] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState(getDefaultProviderModel('openai'));
  const [preferExistingResources, setPreferExistingResources] = useState(true);
  const modelOptions = PROVIDER_MODEL_OPTIONS[provider] || [];

  return (
    <div className="rounded-xl border border-border bg-white/[0.02] p-5 space-y-4">
      <div>
        <div className="text-sm font-medium text-white uppercase tracking-wider">Generate with AI</div>
        <p className="mt-2 text-sm text-secondary">
          Describe the workflow in plain English and DashClaw will draft the basics, linked resources, and executable steps into this editor. Your API key is used only for this request and is not saved.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-error/20 bg-error-subtle px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="workflow-ai-description" className={labelClass}>Workflow request</label>
        <textarea
          id="workflow-ai-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={5}
          className={inputClass}
          placeholder="When a customer asks for a refund, search the refund knowledge base, summarize the policy, then send the answer to Slack for an operator to review."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label htmlFor="workflow-ai-provider" className={labelClass}>Provider</label>
          <select
            id="workflow-ai-provider"
            value={provider}
            onChange={(event) => {
              const nextProvider = event.target.value;
              setProvider(nextProvider);
              setModel(getDefaultProviderModel(nextProvider));
            }}
            className={inputClass}
          >
            {WORKFLOW_AI_PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="workflow-ai-model" className={labelClass}>Model</label>
          <select
            id="workflow-ai-model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className={inputClass}
          >
            {modelOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="workflow-ai-api-key" className={labelClass}>API key</label>
          <input
            id="workflow-ai-api-key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            className={inputClass}
            placeholder="Paste a request-scoped key"
          />
        </div>
      </div>

      <label className="flex items-center gap-3 text-sm text-secondary">
        <input
          type="checkbox"
          checked={preferExistingResources}
          onChange={(event) => setPreferExistingResources(event.target.checked)}
        />
        Prefer existing linked DashClaw resources when possible
      </label>

      <button
        type="button"
        onClick={() => onGenerate({
          description,
          apiKey,
          provider,
          model,
          preferExistingResources,
        })}
        disabled={loading || !description.trim() || !apiKey.trim()}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand/90 disabled:opacity-50"
      >
        {loading ? 'Generating draft...' : 'Generate draft'}
      </button>
    </div>
  );
}
