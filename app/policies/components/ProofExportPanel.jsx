'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileDown, Copy, Check, X, ShieldCheck } from 'lucide-react';

/**
 * Inline panel that fetches the policy proof report (GET /api/policies/proof)
 * and offers copy / download. The compliance proof artifact was previously
 * SDK-only — this surfaces it from the Policies Custom tab.
 */
export default function ProofExportPanel({ open, onClose }) {
  const [format, setFormat] = useState('md');
  const [report, setReport] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (fmt) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/policies/proof?format=${fmt}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to generate proof report');
        setReport('');
      } else {
        setReport(data.report || '');
      }
    } catch {
      setError('Failed to generate proof report');
      setReport('');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    load(format);
  }, [open, format, load]);

  if (!open) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const handleDownload = () => {
    const blob = new Blob([report], {
      type: format === 'json' ? 'application/json' : 'text/markdown',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `policy-proof.${format === 'json' ? 'json' : 'md'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const formatButton = (value, label) => (
    <button
      type="button"
      onClick={() => setFormat(value)}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        format === value
          ? 'bg-brand text-white'
          : 'bg-surface-tertiary text-secondary hover:bg-elevated hover:text-white'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface-secondary p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-brand" aria-hidden="true" />
          <span className="text-sm font-semibold text-white">Policy proof report</span>
        </div>
        <button
          onClick={onClose}
          className="text-tertiary transition-colors hover:text-white"
          aria-label="Close proof report"
        >
          <X size={16} />
        </button>
      </div>
      <p className="text-xs text-secondary">
        A compliance-ready report of every active policy. Copy it into an audit response or download it as an artifact.
      </p>

      <div className="flex items-center gap-2">
        {formatButton('md', 'Markdown')}
        {formatButton('json', 'JSON')}
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error-subtle px-3 py-2 text-xs text-error">{error}</div>
      )}

      <label htmlFor="proof-report-body" className="sr-only">Proof report</label>
      <textarea
        id="proof-report-body"
        readOnly
        value={loading ? 'Generating…' : report}
        rows={12}
        className="w-full resize-none rounded-lg border border-border bg-surface-tertiary px-3 py-2 font-mono text-[11px] leading-relaxed text-secondary focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
      />

      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          disabled={loading || !report}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white disabled:opacity-50"
        >
          {copied ? <Check size={12} className="text-success" aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          onClick={handleDownload}
          disabled={loading || !report}
          className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
        >
          <FileDown size={12} aria-hidden="true" /> Download
        </button>
      </div>
    </div>
  );
}
