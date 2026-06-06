interface SummaryItem {
  key: string;
  label: string;
  toneFor: (value: number) => string;
}

const SUMMARY_ITEMS: SummaryItem[] = [
  { key: 'total', label: 'Total capabilities', toneFor: () => 'text-white' },
  {
    key: 'attention',
    label: 'Attention needed',
    toneFor: (value) => (value > 0 ? 'text-error' : 'text-success'),
  },
  {
    key: 'stale',
    label: 'Stale certifications',
    toneFor: (value) => (value > 0 ? 'text-warning' : 'text-secondary'),
  },
  {
    key: 'uncertified',
    label: 'Uncertified',
    toneFor: (value) => (value > 0 ? 'text-warning' : 'text-secondary'),
  },
];

interface CapabilityRegistrySummaryProps {
  counts?: Record<string, number> | null;
}

export default function CapabilityRegistrySummary({ counts }: CapabilityRegistrySummaryProps) {
  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-border bg-surface-tertiary">
      <div className="grid grid-cols-2 divide-x divide-border md:grid-cols-4">
        {SUMMARY_ITEMS.map((item, i) => {
          const value = counts?.[item.key] ?? 0;
          return (
            <div
              key={item.key}
              className={`px-5 py-4 ${i >= 2 ? 'border-t border-border md:border-t-0' : ''}`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                {item.label}
              </div>
              <div className={`mt-1 text-3xl font-semibold tabular-nums ${item.toneFor(value)}`}>{value}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
