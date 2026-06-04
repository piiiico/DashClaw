'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';

const BASE_SCORES = [
  { type: 'security', score: 80 }, { type: 'deploy', score: 75 },
  { type: 'migrate', score: 70 }, { type: 'apply', score: 60 },
  { type: 'sync', score: 40 }, { type: 'api', score: 35 },
  { type: 'config', score: 30 }, { type: 'cleanup', score: 30 },
  { type: 'build', score: 25 }, { type: 'post', score: 25 },
  { type: 'fix', score: 20 }, { type: 'refactor', score: 20 },
  { type: 'other', score: 20 }, { type: 'message', score: 15 },
  { type: 'test', score: 15 }, { type: 'calendar', score: 10 },
  { type: 'research', score: 10 }, { type: 'review', score: 10 },
  { type: 'monitor', score: 10 }, { type: 'alert', score: 10 },
];

const MODIFIERS = [
  { label: 'Irreversible action', value: '+15' },
  { label: 'Touches production / database', value: '+10' },
  { label: 'Touches filesystem / shell', value: '+5' },
  { label: 'Destructive goal pattern (rm -rf, drop table, etc.)', value: '+20' },
  { label: 'Deployment goal (push, deploy, release, etc.)', value: '+10' },
  { label: 'References secrets / keys / .env', value: '+15' },
];

export default function RiskExplainer() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-secondary hover:text-secondary transition-colors"
      >
        <Info size={12} />
        How are risk scores calculated?
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="mt-3 rounded-xl border border-border bg-surface-tertiary p-4 space-y-4 text-xs">
          <div>
            <div className="text-tertiary uppercase tracking-widest text-[10px] mb-2">Base score by action type</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
              {BASE_SCORES.map(({ type, score }) => (
                <div key={type} className="flex justify-between">
                  <span className="text-secondary">{type}</span>
                  <span className="font-mono text-secondary">{score}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-tertiary uppercase tracking-widest text-[10px] mb-2">Modifiers</div>
            <div className="space-y-1">
              {MODIFIERS.map(({ label, value }) => (
                <div key={label} className="flex justify-between">
                  <span className="text-secondary">{label}</span>
                  <span className="font-mono text-warning">{value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-white/[0.04] pt-3">
            <div className="text-tertiary mb-1">Formula</div>
            <div className="font-mono text-secondary">score = min(base + modifiers, 100)</div>
            <div className="mt-2 text-tertiary">
              Example: <span className="text-secondary">deploy (75) + irreversible (+15) = <span className="text-error font-medium">90</span></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
