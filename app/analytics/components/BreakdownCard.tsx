import { formatCost } from '../../lib/formatCost';

interface BreakdownCardProps {
  title: string;
  items: any[];
  labelKey: string;
  countLabel: string;
}

export default function BreakdownCard({ title, items, labelKey, countLabel }: BreakdownCardProps) {
  const maxPct = Math.max(...items.map(i => i.pct || 0), 1);

  return (
    <div className="rounded-2xl border border-border bg-surface-secondary p-5">
      <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-4">{title}</div>
      {items.length === 0 ? (
        <div className="text-sm text-tertiary">No data in this period.</div>
      ) : (
        <div className="space-y-3">
          {items.map((item, i) => (
            <div key={item[labelKey] || i}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-secondary truncate">{item[labelKey]}</span>
                <span className="text-secondary shrink-0 ml-2">
                  {countLabel === 'cost' ? formatCost(item.cost) : item[countLabel] || 0}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/5">
                <div
                  className="h-1.5 rounded-full bg-brand transition-all"
                  style={{ width: `${Math.max((item.pct / maxPct) * 100, 2)}%` }}
                />
              </div>
              <div className="text-[10px] text-disabled mt-0.5">{item.pct}%</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
