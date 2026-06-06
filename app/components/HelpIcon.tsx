'use client';

import { useState, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';

const STORAGE_PREFIX = 'dashclaw_help_dismissed_';

interface HelpIconProps {
  sectionKey?: string;
  tip?: React.ReactNode;
}

export function HelpIcon({ sectionKey, tip }: HelpIconProps) {
  const [dismissed, setDismissed] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${sectionKey}`);
    setDismissed(stored === '1');
  }, [sectionKey]);

  function dismiss() {
    setOpen(false);
    setDismissed(true);
    localStorage.setItem(`${STORAGE_PREFIX}${sectionKey}`, '1');
  }

  if (dismissed) return null;

  return (
    <span className="relative inline-flex items-center ml-1.5">
      <button
        onClick={() => setOpen(!open)}
        className="text-secondary hover:text-info transition-colors"
        aria-label={`Help: ${sectionKey}`}
      >
        <HelpCircle className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute left-6 top-0 z-50 w-72 rounded-lg border border-zinc-700 bg-tertiary p-3 shadow-xl text-sm text-secondary">
          <p>{tip}</p>
          <button
            onClick={dismiss}
            className="mt-2 text-xs text-info hover:text-info"
          >
            Got it
          </button>
        </div>
      )}
    </span>
  );
}

export function resetAllTips() {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  keys.forEach(k => localStorage.removeItem(k));
}
