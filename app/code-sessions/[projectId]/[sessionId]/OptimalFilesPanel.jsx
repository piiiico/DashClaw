'use client';

import { useState } from 'react';

const GROUP_META = {
  recommended_now: {
    label: 'Recommended now',
    description: 'High-confidence files derived from this session. Safe to land first.',
  },
  optional: {
    label: 'Optional',
    description: 'Useful additions. Review before accepting.',
  },
  not_recommended_yet: {
    label: 'Not recommended yet',
    description: 'Pattern needs more evidence (more sessions, more confidence) before DashClaw proposes a file.',
  },
};

function groupMetaFor(group) {
  return GROUP_META[group] || { label: group || 'Other', description: '' };
}

// Server-side allowlist mirror — keep in sync with
// app/api/code-sessions/sessions/[sessionId]/optimal-files/manifest/route.js
const ALLOWED_PREFIXES = ['CLAUDE.md', '.claude/agentlens/', '.claude/rules/', '.claude/hooks/', '.claude/skills/'];

function isManifestablePath(p) {
  if (!p) return false;
  if (p.startsWith('(')) return false; // placeholder paths like '(none — ...)' are virtual-only
  if (p.includes('..')) return false;
  return ALLOWED_PREFIXES.some(pref => p === pref || p.startsWith(pref));
}

function ConfidenceBadge({ confidence }) {
  if (!confidence) return null;
  const tone = confidence === 'high'
    ? 'text-status-success-subtle border-status-success/30 bg-status-success/10'
    : confidence === 'medium'
      ? 'text-tertiary border-border bg-surface-tertiary'
      : 'text-tertiary/70 border-border/60 bg-transparent';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}>
      {confidence}
    </span>
  );
}

function FileRow({ file, selected, onToggle, disabled }) {
  const [open, setOpen] = useState(false);
  const previewContent = file.content || '';
  const truncated = previewContent.length > 4000;
  const displayContent = truncated ? previewContent.slice(0, 4000) + '\n…\n[truncated]' : previewContent;
  const secretFindings = file.secret_scan?.findings || [];
  const hasContent = previewContent.length > 0;

  return (
    <li className="rounded-md border border-border bg-surface-secondary/40 transition-colors hover:border-border-hover">
      <div className="flex items-start gap-3 p-3">
        <input
          type="checkbox"
          checked={!!selected}
          disabled={disabled}
          onChange={e => onToggle(e.target.checked)}
          className="mt-1 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Include ${file.path}`}
        />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="flex w-full items-center gap-2 text-left"
            aria-expanded={open}
          >
            <span aria-hidden className="text-tertiary">{open ? '▾' : '▸'}</span>
            <code className="truncate font-mono text-xs text-primary">{file.path}</code>
            <ConfidenceBadge confidence={file.confidence} />
            {disabled && (
              <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-tertiary/70">
                preview only
              </span>
            )}
            {secretFindings.length > 0 && (
              <span className="rounded-full border border-status-warning/30 bg-status-warning/10 px-2 py-0.5 text-[10px] text-status-warning">
                {secretFindings.length} redaction{secretFindings.length === 1 ? '' : 's'}
              </span>
            )}
          </button>
          {file.title && (
            <p className="mt-1 ml-5 text-xs text-secondary">{file.title}</p>
          )}
          {open && (
            <div className="ml-5 mt-3 space-y-3 text-xs">
              {file.reason && (
                <div>
                  <span className="text-tertiary">Why · </span>
                  <span className="text-secondary">{file.reason}</span>
                </div>
              )}
              {file.commit_recommendation && (
                <div>
                  <span className="text-tertiary">Commit · </span>
                  <span className="text-secondary">{file.commit_recommendation}</span>
                </div>
              )}
              {file.overwrite_risk && file.overwrite_risk !== 'unknown' && file.overwrite_risk !== 'n/a' && (
                <div>
                  <span className="text-tertiary">Overwrite risk · </span>
                  <span className="text-secondary">{file.overwrite_risk}</span>
                </div>
              )}
              {secretFindings.length > 0 && (
                <div className="rounded border border-status-warning/30 bg-status-warning/5 p-2 text-status-warning">
                  Secret scan redacted: {secretFindings.map(f => f.kind || f.label || 'secret').join(', ')}
                </div>
              )}
              {hasContent ? (
                <details>
                  <summary className="cursor-pointer text-tertiary hover:text-secondary">
                    Preview content · {previewContent.length.toLocaleString()} chars{truncated ? ' · truncated' : ''}
                  </summary>
                  <pre className="mt-2 max-h-72 overflow-auto rounded border border-border bg-bg-primary p-3 text-[11px] leading-relaxed text-secondary">
{displayContent}
                  </pre>
                </details>
              ) : (
                <p className="text-tertiary italic">No content — virtual placeholder.</p>
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
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Preview failed (HTTP ${res.status}). ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      const items = data.bundle || [];
      setBundle(items);
      const initialSel = {};
      for (const f of items) {
        // Default-select high/medium confidence, real (non-virtual) paths only.
        // Virtual placeholders and disallowed paths can never become manifest
        // entries — defaulting them off avoids a confusing 400 on submit.
        const manifestable = !f.virtual && isManifestablePath(f.path);
        initialSel[f.path] = manifestable && f.confidence !== 'low';
      }
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
      // Filter to manifestable paths only — server rejects placeholders with
      // a hard 400, so silently dropping them on the client gives a smoother
      // UX without weakening the server-side allowlist.
      const selections = bundle
        .filter(f => selected[f.path] && !f.virtual && isManifestablePath(f.path))
        .map(f => ({ path: f.path, accept: true }));
      if (selections.length === 0) {
        throw new Error('No manifestable files selected. Virtual placeholders cannot be applied.');
      }
      const res = await fetch(`/api/code-sessions/sessions/${sessionId}/optimal-files/manifest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selections }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Manifest creation failed (HTTP ${res.status}). ${body.slice(0, 240)}`);
      }
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
      <button
        onClick={loadPreview}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-secondary/40 px-4 py-2 text-sm font-medium text-primary transition-colors hover:border-border-hover hover:bg-surface-secondary"
      >
        Generate Optimal Files
      </button>
    );
  }

  if (phase === 'loading') {
    return (
      <p className="text-sm text-tertiary" aria-live="polite">
        Analyzing session and assembling bundle…
      </p>
    );
  }

  if (phase === 'error') {
    return (
      <div className="rounded-md border border-status-error/30 bg-status-error/5 p-4 text-sm">
        <p className="font-medium text-status-error">Generation failed</p>
        <p className="mt-1 text-tertiary">{error}</p>
        <button
          onClick={() => setPhase('idle')}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-secondary hover:bg-surface-secondary"
        >
          Try again
        </button>
      </div>
    );
  }

  if (phase === 'done' && manifest) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-status-success/30 bg-status-success/5 p-4 text-sm">
          <p className="font-medium text-status-success">Manifest ready</p>
          <p className="mt-1 text-xs text-tertiary">
            Expires {new Date(manifest.expires_at).toLocaleString()} · run the
            command below locally. The CLI re-runs the secret scan before
            writing and offers three-way merge for files that already exist on
            disk.
          </p>
        </div>
        <pre className="overflow-x-auto rounded-md border border-border bg-bg-primary p-3 font-mono text-xs text-primary">
{manifest.apply_command}
        </pre>
      </div>
    );
  }

  // phase === 'preview' || 'saving'
  const grouped = new Map();
  for (const f of bundle) {
    const k = f.group || 'other';
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(f);
  }
  const groupOrder = ['recommended_now', 'optional', 'not_recommended_yet'];
  const orderedGroups = [
    ...groupOrder.filter(g => grouped.has(g)).map(g => [g, grouped.get(g)]),
    ...[...grouped.entries()].filter(([g]) => !groupOrder.includes(g)),
  ];
  const acceptedCount = bundle.filter(f =>
    selected[f.path] && !f.virtual && isManifestablePath(f.path),
  ).length;

  function setAll(value) {
    const next = {};
    for (const f of bundle) {
      const manifestable = !f.virtual && isManifestablePath(f.path);
      next[f.path] = value && manifestable;
    }
    setSelected(next);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs">
        <p className="text-tertiary">
          {bundle.length} suggestion{bundle.length === 1 ? '' : 's'} ·{' '}
          <span className="text-secondary">{acceptedCount} ready for manifest</span>
        </p>
        <div className="flex gap-3 text-tertiary">
          <button onClick={() => setAll(true)} className="hover:text-primary">select all</button>
          <span aria-hidden>·</span>
          <button onClick={() => setAll(false)} className="hover:text-primary">clear</button>
        </div>
      </div>

      <div className="space-y-5">
        {orderedGroups.map(([group, items]) => {
          const meta = groupMetaFor(group);
          return (
            <section key={group}>
              <header className="mb-2">
                <h3 className="text-xs font-medium text-secondary">
                  {meta.label}
                  <span className="ml-2 text-tertiary">{items.length}</span>
                </h3>
                {meta.description && (
                  <p className="mt-0.5 text-xs text-tertiary">{meta.description}</p>
                )}
              </header>
              <ul className="space-y-2">
                {items.map(f => (
                  <FileRow
                    key={f.path}
                    file={f}
                    selected={selected[f.path]}
                    onToggle={v => setSelected(s => ({ ...s, [f.path]: v }))}
                    disabled={f.virtual || !isManifestablePath(f.path)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <button
          disabled={phase === 'saving' || acceptedCount === 0}
          onClick={createManifest}
          className="inline-flex items-center gap-2 rounded-md border border-orange-500/40 bg-orange-500/10 px-4 py-2 text-sm font-medium text-orange-300 transition-colors hover:bg-orange-500/15 disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-tertiary"
        >
          {phase === 'saving' ? 'Creating manifest…' : `Create manifest · ${acceptedCount}`}
        </button>
        <p className="text-xs text-tertiary">
          Server will validate every path against the same allowlist before saving.
        </p>
      </div>
    </div>
  );
}
