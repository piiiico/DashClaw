import PolicyAuthoringPanel from './PolicyAuthoringPanel';
import PolicyGeneratedAdvancedDetails from './PolicyGeneratedAdvancedDetails';

export default function PolicyGeneratedDraftEditor({
  draft,
  form,
  setForm,
  policyTypes,
  actionOptions,
  agents,
  summary,
  saving,
  saveDisabled = false,
  onSave,
}) {
  if (!draft || !form) return null;

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-white/[0.02] p-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Generated Draft</h2>
        <p className="mt-1 text-sm text-secondary">
          Review the generated policy, adjust the guided fields, and create it when it looks right.
        </p>
      </div>

      {draft.hasAdvancedDetails && (
        <div className="rounded-lg border border-yellow-500/20 bg-status-warning/10 px-3 py-2 text-sm text-warning">
          Advanced config details need review before saving.
        </div>
      )}

      <PolicyAuthoringPanel
        form={form}
        policyTypes={policyTypes}
        actionOptions={actionOptions}
        agents={agents}
        summary={summary}
        onChange={setForm}
      />

      {draft.hasAdvancedDetails && (
        <PolicyGeneratedAdvancedDetails
          advancedDetails={draft.advancedDetails}
          rawPolicy={draft.rawPolicy}
        />
      )}

      <button
        type="button"
        onClick={onSave}
        disabled={saving || saveDisabled}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
      >
        {saving ? 'Creating...' : 'Create Policy'}
      </button>
    </div>
  );
}
