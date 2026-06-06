interface PolicySummaryCardProps {
  summary?: React.ReactNode;
}

export default function PolicySummaryCard({ summary }: PolicySummaryCardProps) {
  return (
    <div className="rounded-lg border border-border bg-white/[0.03] p-3">
      <div className="text-[10px] uppercase tracking-wider text-tertiary mb-1">Policy summary</div>
      <p className="text-sm text-secondary">{summary}</p>
    </div>
  );
}
