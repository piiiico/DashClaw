'use client';

import { useState } from 'react';

export default function OptimalFilesPanel({ sessionId }) {
  const [phase, setPhase] = useState('idle'); // idle | loading | preview | saving | done | error
  const [bundle, setBundle] = useState([]);
  const [selected, setSelected] = useState({});
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState('');

  async function loadPreview() {
    setPhase('loading');
    setError('');
    try {
      const res = await fetch(`/api/code-sessions/sessions/${sessionId}/optimal-files/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = data.bundle || [];
      setBundle(items);
      const initialSel = {};
      for (const f of items) initialSel[f.path] = f.confidence !== 'low';
      setSelected(initialSel);
      setPhase('preview');
    } catch (err) {
      setError(err.message);
      setPhase('error');
    }
  }

  async function createManifest() {
    setPhase('saving');
    setError('');
    try {
      const selections = bundle
        .filter(f => selected[f.path])
        .map(f => ({ path: f.path, accept: true }));
      const res = await fetch(`/api/code-sessions/sessions/${sessionId}/optimal-files/manifest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selections }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setManifest(data);
      setPhase('done');
    } catch (err) {
      setError(err.message);
      setPhase('error');
    }
  }

  if (phase === 'idle') {
    return (
      <button onClick={loadPreview}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-secondary">
        Generate Optimal Files
      </button>
    );
  }

  if (phase === 'loading') {
    return <p className="text-sm text-tertiary">Analyzing session…</p>;
  }

  if (phase === 'error') {
    return (
      <div className="rounded-md border border-border p-3 text-sm">
        <p className="text-orange-400">Failed: {error}</p>
        <button onClick={() => setPhase('idle')}
                className="mt-2 text-xs underline text-tertiary">retry</button>
      </div>
    );
  }

  if (phase === 'done' && manifest) {
    return (
      <div className="rounded-md border border-border p-3 text-sm">
        <p className="font-medium">Manifest ready</p>
        <p className="mt-1 text-xs text-tertiary">
          Expires {new Date(manifest.expires_at).toLocaleString()}
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-surface-tertiary p-2 text-xs">
{manifest.apply_command}
        </pre>
        <p className="mt-1 text-xs text-tertiary">
          Run this locally to apply the bundle. The CLI re-runs the secret scan
          before writing.
        </p>
      </div>
    );
  }

  // phase === 'preview' || 'saving'
  const acceptedCount = Object.values(selected).filter(Boolean).length;
  return (
    <div className="space-y-2">
      <p className="text-xs text-tertiary">
        {bundle.length} suggested file{bundle.length === 1 ? '' : 's'}. {acceptedCount} selected.
      </p>
      <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
        {bundle.map(f => (
          <li key={f.path} className="text-xs">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={!!selected[f.path]}
                onChange={e => setSelected(s => ({ ...s, [f.path]: e.target.checked }))}
                className="mt-0.5"
              />
              <span className="flex-1">
                <span className="font-mono">{f.path}</span>
                {f.confidence && (
                  <span className="ml-2 rounded bg-surface-tertiary px-1.5 py-0.5 text-[10px] text-tertiary">
                    {f.confidence}
                  </span>
                )}
                {f.title && <span className="block text-tertiary">{f.title}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button
        disabled={phase === 'saving' || acceptedCount === 0}
        onClick={createManifest}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {phase === 'saving' ? 'Creating…' : `Create manifest (${acceptedCount})`}
      </button>
    </div>
  );
}
