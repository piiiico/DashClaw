'use client';

import { useCallback, useState } from 'react';
import { Copy, CheckCircle2 } from 'lucide-react';

interface CopyableValueRowProps {
  label?: string;
  value?: string;
  mono?: boolean;
  fallback?: string;
}

/**
 * One labelled value row with a copy button on the right. Used inside
 * the Environment block on the Settings setup tab. Mirrors the styling
 * of the surrounding Host / API key / Runtime rows so this slots in
 * without adding a new visual primitive.
 */
export default function CopyableValueRow({ label, value, mono = true, fallback = '' }: CopyableValueRowProps) {
  const [copied, setCopied] = useState(false);
  const display = value || fallback;
  const canCopy = Boolean(value);

  const handleCopy = useCallback(async () => {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(value as string);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable: silent fail
    }
  }, [value, canCopy]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-tertiary">{label}</span>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!canCopy}
          className="rounded p-1 text-tertiary transition-colors hover:text-secondary disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Copy ${label}`}
          title={copied ? 'Copied' : 'Copy'}
        >
          {copied ? (
            <CheckCircle2 size={12} className="text-success" />
          ) : (
            <Copy size={12} />
          )}
        </button>
      </div>
      <div
        className={[
          'break-all rounded border border-border bg-surface-tertiary p-2 text-xs',
          mono ? 'font-mono' : '',
          canCopy ? 'text-secondary' : 'text-tertiary',
        ].join(' ')}
      >
        {display}
      </div>
    </div>
  );
}
