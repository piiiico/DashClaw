import PolicyDraftCandidateCard from './PolicyDraftCandidateCard';

export default function PolicyDraftCandidateList({
  drafts,
  selectedDraftId,
  onSelectDraft,
}) {
  if (!drafts.length) return null;

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-white">Generated Drafts</div>
      <div className="space-y-3">
        {drafts.map((draft) => (
          <PolicyDraftCandidateCard
            key={draft.id}
            draft={draft}
            selected={draft.id === selectedDraftId}
            onSelect={() => onSelectDraft(draft.id)}
          />
        ))}
      </div>
    </div>
  );
}
