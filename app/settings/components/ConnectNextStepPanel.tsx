'use client';

import { useState, useCallback } from 'react';
import { getNodeStarterSnippet, getPythonStarterSnippet } from '../../lib/starterSnippet';

function getCurlSnippet(host: string) {
  return `curl -X POST ${host}/api/actions \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: <YOUR_API_KEY>" \\
  -d '{"action_type":"test","declared_goal":"Verify DashClaw connection"}'`;
}

interface ConnectNextStepPanelProps {
  maskedApiKey?: string;
  host?: string;
  isAuthenticated?: boolean;
  overallState?: string;
}

export function ConnectNextStepPanel({ maskedApiKey, host, isAuthenticated, overallState }: ConnectNextStepPanelProps) {
  const [apiKey, setApiKey] = useState(maskedApiKey || '');
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [result, setResult] = useState<any>(null);

  const runTest = useCallback(async () => {
    setStatus('loading');
    setResult(null);
    try {
      const res = await fetch('/api/setup/ping', {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
      });
      const data = await res.json();
      if (data.ok) {
        // Redirect with proof token so the page reloads as "verified"
        if (data.proof_token) {
          window.location.href = `/settings?proof=${encodeURIComponent(data.proof_token)}`;
          return;
        }
        setStatus('success');
        setResult(data);
      } else {
        setStatus('error');
        setResult(data);
      }
    } catch {
      setStatus('error');
      setResult({ message: 'Network error. Could not reach the instance.' });
    }
  }, [apiKey]);

  const showSnippets =
    (overallState === 'ready_unverified' || overallState === 'verified') &&
    (status === 'idle' || status === 'success');

  return (
    <div className="mt-6 space-y-4">
      {/* Test connection card */}
      <div
        className={`rounded-2xl border p-6 ${
          status === 'success'
            ? 'border-emerald-900/40 bg-emerald-950/20'
            : 'border-border bg-surface-secondary'
        }`}
      >
        <p className="text-xs uppercase tracking-[0.3em] text-tertiary">Test your connection</p>

        {status === 'success' ? (
          <div className="mt-4">
            <p className="text-sm font-medium text-success">
              Connected. Your instance is accepting authenticated requests.
            </p>
            {result?.latencyMs != null && (
              <p className="mt-1 text-xs text-tertiary">Latency: {result.latencyMs}ms</p>
            )}
            <button
              type="button"
              onClick={() => { setStatus('idle'); setResult(null); }}
              className="mt-3 text-xs text-tertiary underline hover:text-secondary"
            >
              Run again
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <label htmlFor="setup-api-key" className="block text-xs font-medium text-secondary">
              API Key
            </label>
            <input
              id="setup-api-key"
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your API key"
              className="mt-1 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm font-mono text-secondary placeholder:text-disabled focus:border-brand/50 focus:outline-none focus:ring-1 focus:ring-brand/30"
            />
            {status === 'error' && result?.message && (
              <p className="mt-2 text-xs text-warning">{result.message}</p>
            )}
            <button
              type="button"
              onClick={runTest}
              disabled={status === 'loading' || !apiKey}
              className="mt-3 inline-flex items-center rounded-full border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:border-brand/60 hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {status === 'loading' ? 'Testing…' : 'Run test'}
            </button>
          </div>
        )}
      </div>

      {/* SDK snippet cards */}
      {showSnippets && (
        <div className="grid gap-4 lg:grid-cols-3">
          <SnippetCard label="Node" code={getNodeStarterSnippet({ baseUrl: host })} />
          <SnippetCard label="Python" code={getPythonStarterSnippet({ baseUrl: host })} />
          <SnippetCard label="cURL" code={getCurlSnippet(host as string)} />
        </div>
      )}
    </div>
  );
}

interface SnippetCardProps {
  label?: string;
  code?: string;
}

function SnippetCard({ label, code }: SnippetCardProps) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code as string);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }, [code]);

  return (
    <div className="rounded-xl border border-border bg-surface-tertiary p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.24em] text-tertiary">{label}</p>
        <button
          type="button"
          onClick={copy}
          className="text-tertiary hover:text-secondary transition-colors"
          aria-label={`Copy ${label} snippet`}
        >
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          )}
        </button>
      </div>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl border border-border bg-surface-tertiary px-4 py-3 text-xs font-mono text-secondary">
        {code}
      </pre>
    </div>
  );
}
