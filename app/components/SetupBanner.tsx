'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight, Rocket, X } from 'lucide-react';

export default function SetupBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    fetch('/api/setup/status')
      .then(res => res.json())
      .then(data => {
        if (data && data.configured === false) setShow(true);
      })
      .catch(() => {}); // silently ignore — probably on marketing site
  }, []);

  if (!show) return null;

  return (
    <div className="bg-brand/10 border-b border-brand/20">
      <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-sm">
          <Rocket size={16} className="text-brand shrink-0" />
          <span className="text-secondary">
            <strong className="text-white">Welcome to your DashClaw instance!</strong>{' '}
            Complete setup to start governing agents.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-brand hover:bg-brand/90 rounded-lg transition-colors whitespace-nowrap"
          >
            Go to Setup <ArrowRight size={12} />
          </Link>
          <button
            onClick={() => setShow(false)}
            className="p-1 text-secondary hover:text-secondary transition-colors"
            aria-label="Dismiss banner"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
