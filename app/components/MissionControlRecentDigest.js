'use client';

import { Clock } from 'lucide-react';
import { Badge } from './ui/Badge';

export default function MissionControlRecentDigest({ digest }) {
  return (
    <div className="mb-6 rounded-xl border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.022),rgba(255,255,255,0.008))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Clock size={14} className="text-secondary" />
            <div className="text-xs font-semibold uppercase tracking-wider text-secondary">What Changed In The Last 15 Minutes</div>
          </div>
          <div className="text-sm text-tertiary">
            Delta summary of recent decision movement, governance pressure, interventions, and outcomes.
          </div>
        </div>
        <Badge variant={digest.total > 0 ? 'brand' : 'default'} size="sm">
          {digest.total} recent changes
        </Badge>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {digest.changes.map((change) => (
            <div key={change.id} className="rounded-lg border border-border-hover bg-white/[0.02] px-3 py-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-tertiary">{change.label}</div>
              <div className="mb-1 text-2xl font-semibold tabular-nums text-white">{change.count}</div>
              <div className="text-xs leading-5 text-tertiary">{change.detail}</div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border-hover bg-white/[0.02] px-3 py-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tertiary">Recent posture shifts</div>
          {digest.highlights.length === 0 ? (
            <div className="text-xs leading-5 text-tertiary">No high-signal changes landed in the last 15 minutes.</div>
          ) : (
            <div className="space-y-2">
              {digest.highlights.map((item) => (
                <div key={item.id} className="rounded-md border border-white/[0.06] bg-black/20 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-sm font-medium text-white">{item.title}</div>
                    <span className="text-[10px] uppercase tracking-wider text-tertiary">{item.status}</span>
                  </div>
                  <div className="text-xs text-secondary">{item.detail}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
