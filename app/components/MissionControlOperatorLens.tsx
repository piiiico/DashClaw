'use client';

import { Filter } from 'lucide-react';
import { OPERATOR_CHANNEL_OPTIONS } from '../lib/missionControl';

interface MissionControlOperatorLensProps {
  activeCategory?: string;
  onCategoryChange?: (id: string) => void;
  showTelemetry?: boolean;
  onToggleTelemetry?: () => void;
}

export default function MissionControlOperatorLens({
  activeCategory,
  onCategoryChange,
  showTelemetry,
  onToggleTelemetry,
}: MissionControlOperatorLensProps) {
  return (
    <div className="mb-6 rounded-xl border border-border bg-surface-secondary px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-secondary" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-secondary">Operator Lens</div>
            <div className="text-xs text-tertiary">Apply the same signal filter to both the decision timeline and live mission feed.</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {OPERATOR_CHANNEL_OPTIONS.map((option: any) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onCategoryChange?.(option.id)}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                activeCategory === option.id
                  ? 'border-brand/40 bg-brand/10 text-brand'
                  : 'border-white/10 text-tertiary hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onToggleTelemetry}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
              showTelemetry
                ? 'border-brand/40 bg-brand/10 text-brand'
                : 'border-white/10 text-tertiary hover:text-white'
            }`}
          >
            {showTelemetry ? 'Telemetry visible' : 'Hide telemetry'}
          </button>
        </div>
      </div>
    </div>
  );
}
