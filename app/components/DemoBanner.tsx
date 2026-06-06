'use client';

import Link from 'next/link';
import { FlaskConical } from 'lucide-react';
import { isDemoMode } from '../lib/isDemoMode';

// Demo mode is a sustained "this is not production data" notice. Per
// .impeccable.md, brand orange is reserved for signal — not ambient wallpaper —
// so the banner sits on a neutral elevated surface with an amber accent
// (warning-state token) rather than an always-on brand wash.
export default function DemoBanner() {
  if (!isDemoMode()) return null;

  return (
    <div
      role="note"
      aria-label="Demo mode"
      className="border-b border-border bg-surface-secondary"
    >
      <div className="flex flex-col gap-2 px-6 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 text-xs text-secondary">
          <span className="flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-subtle px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-warning">
            <FlaskConical size={11} aria-hidden="true" />
            Demo
          </span>
          <span className="text-secondary">
            Simulated data. Deploy your own DashClaw instance to connect real agents.
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <Link
            href="/self-host"
            className="text-brand transition-colors hover:text-brand-hover"
          >
            Get started
          </Link>
          <Link
            href="/"
            className="text-secondary transition-colors hover:text-white"
          >
            What is DashClaw?
          </Link>
        </div>
      </div>
    </div>
  );
}
