'use client';

import { useCallback, useEffect, useState } from 'react';
import { ScanText, ShieldAlert } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';

// Operator surfaces for the two ad-hoc security scanners:
//   POST /api/security/scan              — secrets / PII (DLP), returns redacted_text
//   POST /api/security/prompt-injection  — prompt-injection risk + recommendation
//   GET  /api/security/prompt-injection  — recent stored scans (metadata only)
// Both endpoints store metadata (a content hash + counts) only, never the text.

const MODES = [
  { value: 'dlp', label: 'Secrets / PII', endpoint: '/api/security/scan' },
  { value: 'injection', label: 'Prompt injection', endpoint: '/api/security/prompt-injection' },
];

const SEVERITY_VARIANT: Record<string, string> = { critical: 'error', high: 'error', medium: 'warning', low: 'info', info: 'info' };
const RISK_VARIANT: Record<string, string> = { critical: 'error', high: 'error', medium: 'warning', low: 'info', none: 'success' };

function severityVariant(sev: string): string {
  return SEVERITY_VARIANT[sev] || 'info';
}

export default function SecurityScanners() {
  const [mode, setMode] = useState('dlp');
  const [text, setText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentScans, setRecentScans] = useState<any[]>([]);

  const loadRecentScans = useCallback(async () => {
    try {
      const res = await fetch('/api/security/prompt-injection?limit=10');
      if (res.ok) {
        const data = await res.json();
        setRecentScans(data.scans || []);
      }
    } catch {
      // history is best-effort
    }
  }, []);

  useEffect(() => {
    loadRecentScans();
  }, [loadRecentScans]);

  const activeMode = MODES.find((m) => m.value === mode)!;

  const handleScan = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(activeMode.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Scan failed');
        return;
      }
      setResult({ mode, ...data });
      if (mode === 'injection') loadRecentScans();
    } catch (err: any) {
      setError(err.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const switchMode = (next: string) => {
    setMode(next);
    setResult(null);
    setError(null);
  };

  return (
    <Card className="mb-6" hover={false}>
      <CardHeader
        title={<span className="flex items-center gap-2"><ScanText size={14} className="text-brand" aria-hidden="true" />Scan text</span>}
      />
      <CardContent className="space-y-4">
        <div role="tablist" aria-label="Scanner type" className="flex items-center gap-1.5">
          {MODES.map((m) => (
            <button
              key={m.value}
              role="tab"
              aria-selected={mode === m.value}
              onClick={() => switchMode(m.value)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === m.value
                  ? 'border-brand/30 bg-brand/10 text-brand'
                  : 'border-transparent text-tertiary hover:border-border hover:text-secondary'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleScan} className="space-y-3">
          <label className="block">
            <span className="sr-only">Text to scan</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder={mode === 'dlp'
                ? 'Paste text to check for secrets or PII before it leaves your agent…'
                : 'Paste untrusted input (tool output, retrieved content) to check for prompt-injection…'}
              aria-label="Text to scan"
              className="w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 font-mono text-sm text-white placeholder:text-disabled focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-tertiary">Only a content hash and finding counts are stored — never the text itself.</p>
            <button
              type="submit"
              disabled={scanning || !text.trim()}
              aria-busy={scanning}
              className="rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
            >
              {scanning ? 'Scanning…' : 'Scan'}
            </button>
          </div>
        </form>

        {error && (
          <div role="alert" className="rounded-lg border border-error/20 bg-error-subtle px-3 py-2 text-sm text-error">{error}</div>
        )}

        {result && result.mode === 'dlp' && (
          <div className="space-y-3 rounded-lg border border-border bg-surface-tertiary px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {result.clean
                ? <Badge variant="success" size="xs">Clean</Badge>
                : <Badge variant="error" size="xs">{result.findings_count} finding{result.findings_count === 1 ? '' : 's'}</Badge>}
              {result.critical_count > 0 && <Badge variant="error" size="xs">{result.critical_count} critical</Badge>}
              {result.categories?.map((c: string) => <Badge key={c} variant="info" size="xs">{c}</Badge>)}
            </div>
            {result.findings?.length > 0 && (
              <ul className="space-y-1 text-xs text-secondary">
                {result.findings.map((f: any, i: number) => (
                  <li key={i} className="flex items-center gap-2">
                    <Badge variant={severityVariant(f.severity)} size="xs">{f.severity}</Badge>
                    <span>{f.category}{f.description ? ` — ${f.description}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Redacted text</div>
              <pre className="max-h-48 overflow-auto rounded-md border border-border bg-surface-secondary px-3 py-2 font-mono text-xs text-secondary whitespace-pre-wrap">{result.redacted_text}</pre>
            </div>
          </div>
        )}

        {result && result.mode === 'injection' && (
          <div className="space-y-2 rounded-lg border border-border bg-surface-tertiary px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={RISK_VARIANT[result.risk_level] || 'info'} size="xs">{result.risk_level} risk</Badge>
              {result.critical_count > 0 && <Badge variant="error" size="xs">{result.critical_count} critical</Badge>}
              {result.categories?.map((c: string) => <Badge key={c} variant="info" size="xs">{c}</Badge>)}
            </div>
            {result.recommendation && <p className="text-xs text-secondary">Recommendation: {result.recommendation}</p>}
            {result.findings?.length > 0 && (
              <ul className="space-y-1 text-xs text-secondary">
                {result.findings.map((f: any, i: number) => (
                  <li key={i} className="flex items-center gap-2">
                    <Badge variant={severityVariant(f.severity)} size="xs">{f.severity}</Badge>
                    <span>{f.category}{f.description ? ` — ${f.description}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {recentScans.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
              <ShieldAlert size={12} aria-hidden="true" /> Recent prompt-injection scans
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {recentScans.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <Badge variant={RISK_VARIANT[s.risk_level] || 'info'} size="xs">{s.risk_level}</Badge>
                  <span className="flex-1 truncate text-secondary">{s.recommendation || s.source || '—'}</span>
                  <span className="tabular-nums text-tertiary">{s.findings_count} finding{s.findings_count === 1 ? '' : 's'}</span>
                  <span className="tabular-nums text-tertiary">{s.scanned_at ? new Date(s.scanned_at).toLocaleString() : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
