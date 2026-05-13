'use client';

import { useState } from 'react';

const GROUP_LABELS = {
  claude_md: 'Root CLAUDE.md',
  rules: 'Path-scoped rules (.claude/rules/)',
  hooks: 'Hook configs (.claude/hooks/)',
  skills: 'Skill packs (.claude/skills/)',
  context: 'Session context pack',
  recipe: 'Next-session recipe',
};

function groupLabelFor(group) {
  return GROUP_LABELS[group] || group || 'Other';
}

function FileRow({ file, selected, onToggle }) {
  const [open, setOpen] = useState(false);
  const previewContent = file.content || '';
  const truncated = previewContent.length > 4000;
  const displayContent = truncated ? previewContent.slice(0, 4000) + '\n…\n[truncated]' : previewContent;
  const secretFindings = file.secret_scan?.findings || [];

  return (
    <li className="rounded border border-border p-2 text-xs">
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={!!selected}
          onChange={e => onToggle(e.target.checked)}
          className="mt-1"
          aria-label={`Include ${file.path}`}
        />
        <div className="flex-1">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="flex w-full items-center gap-2 text-left hover:text-primary"
          >
            <span aria-hidden className="text-tertiary">{open ? '▾' : '▸'}</span>
            <span className="font-mono">{file.path}</span>
            {file.confidence && (
              <span className="rounded bg-surface-tertiary px-1.5 py-0.5 text-[10px] text-tertiary uppercase">
                {file.confidence}
              </span>
            )}
            {file.virtual && (
              <span className="rounded bg-surface-tertiary px-1.5 py-0.5 text-[10px] text-tertiary">virtual</span>
            )}
            {secretFindings.length > 0 && (
              <span className="rounded bg-orange-400/20 px-1.5 py-0.5 text-[10px] text-orange-300">
                {secretFindings.length} redaction{secretFindings.length === 1 ? '' : 's'}
              </span>
            )}
          </button>
          {file.title && <div className="mt-0.5 ml-5 text-tertiary">{file.title}</div>}
          {open && (
            <div className="ml-5 mt-2 space-y-2">
              {file.reason && (
                <div className="text-tertiary"><span className="font-medium text-secondary">Why: </span>{file.reason}</div>
              )}
              {file.commit_recommendation && (
                <div className="text-tertiary">
                  <span className="font-medium text-secondary">Commit recommendation: </span>
                  {file.commit_recommendation}
                </div>
              )}
              {file.overwrite_risk && file.overwrite_risk !== 'unknown' && (
                <div className="text-tertiary">
                  <span className="font-medium text-secondary">Overwrite risk: </span>
                  {file.overwrite_risk}
                </div>
              )}
              {secretFindings.length > 0 && (
                <div className="text-orange-300">
                  <span className="font-medium">Secret scan flagged: </span>
                  {secretFindings.map(f => f.kind || f.label || 'secret').join(', ')}
                </div>
              )}
              {previewContent && (
                <details>
                  <summary className="cursor-pointer text-tertiary">
                    Preview content ({previewContent.length.toLocaleString()} chars{truncated ? ', truncated' : ''})
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded bg-surface-tertiary p-2 text-[11px] leading-tight">
{displayContent}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

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
          before writing and gives you three-way merge for any file that already
          exists at the destination.
        </p>
      </div>
    );
  }

  // phase === 'preview' || 'saving' — group by category, expand-on-click per row
  const grouped = new Map();
  for (const f of bundle) {
    const k = f.group || 'other';
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(f);
  }
  const acceptedCount = Object.values(selected).filter(Boolean).length;

  function setAll(value) {
    const next = {};
    for (const f of bundle) next[f.path] = value;
    setSelected(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-tertiary">
          {bundle.length} suggested · {acceptedCount} selected
        </span>
        <div className="flex gap-2">
          <button onClick={() => setAll(true)} className="text-tertiary underline hover:text-primary">select all</button>
          <button onClick={() => setAll(false)} className="text-tertiary underline hover:text-primary">clear</button>
        </div>
      </div>
      <div className="max-h-[28rem] space-y-3 overflow-y-auto rounded-md border border-border p-2">
        {[...grouped.entries()].map(([group, items]) => (
          <div key={group}>
            <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-tertiary">
              {groupLabelFor(group)} <span className="text-tertiary/70">({items.length})</span>
            </h3>
            <ul className="space-y-1">
              {items.map(f => (
                <FileRow
                  key={f.path}
                  file={f}
                  selected={selected[f.path]}
                  onToggle={v => setSelected(s => ({ ...s, [f.path]: v }))}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
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
