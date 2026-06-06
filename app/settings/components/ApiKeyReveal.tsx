'use client';

import { useState, useCallback } from 'react';
import { Eye, EyeOff, Copy, CheckCircle2 } from 'lucide-react';

interface ApiKeyRevealProps {
  maskedApiKey?: string;
}

/**
 * Reveal + copy UI for the Environment panel's masked API key display.
 * Click the eye icon to fetch /api/keys/reveal, click copy to put the
 * current value (revealed or masked) on the clipboard.
 */
export function ApiKeyReveal({ maskedApiKey }: ApiKeyRevealProps) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const hasKey = Boolean(maskedApiKey);
  const displayValue = revealed || maskedApiKey || 'Not set';
  const canInteract = hasKey;

  const handleReveal = useCallback(async () => {
    if (revealed) {
      setRevealed(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/keys/reveal');
      if (res.ok) {
        const data = await res.json();
        if (data?.key) {
          setRevealed(data.key);
        } else {
          setError('Unexpected response from server');
        }
      } else if (res.status === 401) {
        setError('Sign in to reveal the API key');
      } else if (res.status === 403) {
        setError('Admin access required');
      } else if (res.status === 404) {
        let data = null;
        try { data = await res.json(); } catch { /* ignore */ }
        setError(data?.hint || 'No API key configured');
      } else {
        setError('Failed to reveal API key');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [revealed]);

  const handleCopy = useCallback(async () => {
    const value = revealed || maskedApiKey;
    if (!value || value === 'Not set') return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — silent */
    }
  }, [revealed, maskedApiKey]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-tertiary">API key</span>
        {canInteract && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleReveal}
              disabled={loading}
              className="rounded p-1 text-tertiary transition-colors hover:text-secondary disabled:opacity-50"
              aria-label={revealed ? 'Hide API key' : 'Reveal API key'}
              title={revealed ? 'Hide' : 'Reveal'}
            >
              {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="rounded p-1 text-tertiary transition-colors hover:text-secondary"
              aria-label="Copy API key"
              title={copied ? 'Copied' : 'Copy'}
            >
              {copied ? (
                <CheckCircle2 size={12} className="text-success" />
              ) : (
                <Copy size={12} />
              )}
            </button>
          </div>
        )}
      </div>
      <div className="break-all rounded border border-border bg-surface-tertiary p-2 font-mono text-xs text-secondary">
        {displayValue}
      </div>
      {error && (
        <p className="mt-1 text-[10px] text-warning">{error}</p>
      )}
    </div>
  );
}
