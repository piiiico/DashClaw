function confidenceTone(confidence) {
  if (confidence >= 0.9) return 'text-success';
  if (confidence >= 0.7) return 'text-warning';
  return 'text-error';
}

export default function PolicyDraftCandidateCard({
  draft,
  selected,
  onSelect,
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-4 text-left transition-colors ${
        selected
          ? 'border-brand bg-[rgba(255,255,255,0.04)]'
          : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-white">{draft.name || 'Untitled draft'}</div>
          <div className="mt-1 text-[11px] uppercase tracking-wider text-tertiary">
            {(draft.formState?.type || 'policy').replace(/_/g, ' ')}
          </div>
        </div>
        {draft.confidence != null && (
          <div className={`text-xs font-medium ${confidenceTone(draft.confidence)}`}>
            {(draft.confidence * 100).toFixed(0)}% confidence
          </div>
        )}
      </div>
      <p className="mt-3 text-sm text-secondary">{draft.summary}</p>
      {draft.hasAdvancedDetails && (
        <div className="mt-3 text-xs text-warning">
          Advanced review needed
        </div>
      )}
    </button>
  );
}
