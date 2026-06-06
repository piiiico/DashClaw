'use client';

import { useRealtime } from '../hooks/useRealtime';

// Per .impeccable.md "calm under pressure": the header-level live indicator
// does not pulse. A single static dot in the corner signals "connected"
// just as well and does not put motion in the operator's peripheral vision
// every second of their workday.
export default function RealtimeIndicator() {
  // Just hooking into it keeps the connection alive
  useRealtime(() => {});

  return (
    <div
      role="status"
      aria-label="Realtime connection live"
      className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success-subtle px-2 py-0.5"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-status-success" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-success">Live</span>
    </div>
  );
}
