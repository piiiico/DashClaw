import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatProps {
  label?: React.ReactNode;
  value?: React.ReactNode;
  change?: React.ReactNode;
  trend?: string;
}

export function Stat({ label, value, change, trend }: StatProps) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums text-white">{value}</div>
      {change !== undefined && (
        <div className={`mt-1 flex items-center gap-1 text-xs font-medium tabular-nums ${trend === 'up' ? 'text-success' : trend === 'down' ? 'text-error' : 'text-tertiary'}`}>
          {trend === 'up' && <TrendingUp size={12} />}
          {trend === 'down' && <TrendingDown size={12} />}
          <span>{change}</span>
        </div>
      )}
    </div>
  );
}

interface StatCompactProps {
  label?: React.ReactNode;
  value?: React.ReactNode;
  color?: string;
}

export function StatCompact({ label, value, color = 'text-white' }: StatCompactProps) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
