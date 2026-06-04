'use client';

import { useState } from 'react';

const inputClass = 'w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand';
const labelClass = 'block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5';

function toggleArrayValue(values, candidate) {
  return values.includes(candidate)
    ? values.filter((value) => value !== candidate)
    : [...values, candidate];
}

function ResourceChecklist({
  label,
  options = [],
  selectedValues = [],
  onToggle,
  emptyText,
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <label className={labelClass}>{label}</label>
        <span className="text-xs text-tertiary">{selectedValues.length} selected</span>
      </div>
      {options.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-sm text-tertiary">
          {emptyText}
        </div>
      ) : (
        <div className="max-h-48 space-y-2 overflow-auto rounded-lg border border-white/10 bg-black/20 p-3">
          {options.map((option) => {
            const checked = selectedValues.includes(option.value);
            return (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent px-2 py-2 text-sm text-secondary transition-colors hover:border-white/10 hover:bg-white/5"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(option.value)}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <div className="text-sm text-white">{option.label}</div>
                  {option.subtitle && (
                    <div className="text-xs text-tertiary">{option.subtitle}</div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function WorkflowLinkedResourcesSection({
  draft,
  resourceOptions,
  onChange,
  saveAction = null,
}) {
  const [tagInput, setTagInput] = useState('');

  function updateField(field, value) {
    onChange({ [field]: value });
  }

  function addTag() {
    const nextTag = tagInput.trim();
    if (!nextTag) return;
    if (draft.linked_capability_tags.includes(nextTag)) {
      setTagInput('');
      return;
    }
    updateField('linked_capability_tags', [...draft.linked_capability_tags, nextTag]);
    setTagInput('');
  }

  return (
    <div className="rounded-xl border border-border bg-white/[0.02] p-5 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-white uppercase tracking-wider">Linked resources</div>
          <p className="mt-2 text-sm text-secondary">
            Link the workflow to real DashClaw resources so steps and future runs have the right context.
          </p>
        </div>
        {saveAction && (
          <button
            type="button"
            onClick={saveAction.onClick}
            disabled={saveAction.disabled}
            className="rounded-lg bg-brand px-3 py-2 text-sm text-white transition-colors hover:bg-brand/90 disabled:opacity-50"
          >
            {saveAction.label}
          </button>
        )}
      </div>

      <div>
        <label htmlFor="workflow-model-strategy" className={labelClass}>Model strategy</label>
        <select
          id="workflow-model-strategy"
          value={draft.model_strategy_id}
          onChange={(event) => updateField('model_strategy_id', event.target.value)}
          className={inputClass}
        >
          <option value="">No linked model strategy</option>
          {(resourceOptions.modelStrategies || []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.unavailable ? `${option.label} (Unavailable)` : option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ResourceChecklist
          label="Policies"
          options={resourceOptions.policies}
          selectedValues={draft.linked_policy_ids}
          onToggle={(value) => updateField('linked_policy_ids', toggleArrayValue(draft.linked_policy_ids, value))}
          emptyText="No active policies available."
        />
        <ResourceChecklist
          label="Knowledge collections"
          options={resourceOptions.knowledgeCollections}
          selectedValues={draft.linked_knowledge_collection_ids}
          onToggle={(value) => updateField('linked_knowledge_collection_ids', toggleArrayValue(draft.linked_knowledge_collection_ids, value))}
          emptyText="No knowledge collections available."
        />
        <ResourceChecklist
          label="Capabilities"
          options={resourceOptions.capabilities}
          selectedValues={draft.linked_capability_ids}
          onToggle={(value) => updateField('linked_capability_ids', toggleArrayValue(draft.linked_capability_ids, value))}
          emptyText="No capabilities available."
        />
        <ResourceChecklist
          label="Prompt templates"
          options={resourceOptions.promptTemplates}
          selectedValues={draft.linked_prompt_template_ids}
          onToggle={(value) => updateField('linked_prompt_template_ids', toggleArrayValue(draft.linked_prompt_template_ids, value))}
          emptyText="No prompt templates available."
        />
      </div>

      <div>
        <label htmlFor="workflow-capability-tag-input" className={labelClass}>Capability tags</label>
        <div className="flex flex-wrap gap-2 mb-3">
          {draft.linked_capability_tags.length === 0 ? (
            <span className="text-sm text-tertiary">No capability tags linked yet.</span>
          ) : draft.linked_capability_tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => updateField('linked_capability_tags', draft.linked_capability_tags.filter((candidate) => candidate !== tag))}
              className="rounded-full border border-active/20 bg-brand/10 px-3 py-1 text-xs text-orange-200 transition-colors hover:bg-brand/20"
            >
              {tag} ×
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            id="workflow-capability-tag-input"
            type="text"
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addTag();
              }
            }}
            className={inputClass}
            placeholder="support, notifications, customer-success"
          />
          <button
            type="button"
            onClick={addTag}
            className="rounded-lg bg-white/5 px-3 py-2 text-sm text-secondary transition-colors hover:bg-white/10"
          >
            Add tag
          </button>
        </div>
      </div>
    </div>
  );
}
