'use client';

import { useState } from 'react';
import { ArrowRight, Copy, Check, Pencil, RotateCcw } from 'lucide-react';

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

function FileRow({ file, selected, onToggle, disabled, defaultOpen, edited, onEdit }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const baseContent = file.content || '';
  const currentContent = edited != null ? edited : baseContent;
  const isEdited = edited != null && edited !== baseContent;
  const truncated = currentContent.length > 4000;
  const displayContent = truncated && !editing
    ? currentContent.slice(0, 4000) + '\n…\n[truncated]'
    : currentContent;
  const secretFindings = file.secret_scan?.findings || [];
  const hasContent = baseContent.length > 0;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(currentContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable in non-secure contexts; fall back to
      // selecting the pre element so the user can copy manually.
    }
  }

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
            {isEdited && (
              <span className="rounded-full border border-orange-500/40 bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-300">
                edited
              </span>
            )}
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
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-tertiary">
                      Content · {currentContent.length.toLocaleString()} chars
                      {truncated && !editing ? ' · truncated' : ''}
                    </span>
                    <div className="ml-auto flex items-center gap-1">
                      {!disabled && !editing && (
                        <button
                          type="button"
                          onClick={() => setEditing(true)}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-secondary hover:border-border-hover hover:text-primary"
                          aria-label={`Edit ${file.path}`}
                        >
                          <Pencil className="h-3 w-3" aria-hidden />
                          Edit
                        </button>
                      )}
                      {!disabled && editing && isEdited && (
                        <button
                          type="button"
                          onClick={() => { onEdit(null); }}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-secondary hover:border-border-hover hover:text-primary"
                          aria-label={`Reset ${file.path}`}
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden />
                          Reset
                        </button>
                      )}
                      {!disabled && editing && (
                        <button
                          type="button"
                          onClick={() => setEditing(false)}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-secondary hover:border-border-hover hover:text-primary"
                        >
                          Done
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleCopy}
                        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-secondary hover:border-border-hover hover:text-primary"
                        aria-label={`Copy ${file.path} content`}
                      >
                        {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  {editing ? (
                    <textarea
                      value={currentContent}
                      onChange={e => onEdit(e.target.value)}
                      spellCheck={false}
                      rows={Math.min(24, Math.max(8, currentContent.split('\n').length + 1))}
                      className="block w-full resize-y rounded border border-border bg-primary p-3 font-mono text-[11px] leading-relaxed text-primary focus:border-border-active focus:outline-none focus:ring-1 focus:ring-orange-500/30"
                    />
                  ) : (
                    <pre className="max-h-72 overflow-auto rounded border border-border bg-primary p-3 text-[11px] leading-relaxed text-secondary">
{displayContent}
                    </pre>
                  )}
                </div>
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
  const [edits, setEdits] = useState({}); // { [path]: editedContent | null (=reset) }
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
      setEdits({});
      setPhase('preview');
    } catch (err) {
      setError(err.message);
      setPhase('error');
    }
  }

  function handleEdit(path, content) {
    setEdits(e => {
      if (content === null) {
        const { [path]: _drop, ...rest } = e;
        return rest;
      }
      return { ...e, [path]: content };
    });
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
        .map(f => {
          const sel = { path: f.path, accept: true };
          // Pass edited content through so the manifest stores the edited
          // version. The server validates the path against the same
          // allowlist regardless of whether content was overridden.
          if (edits[f.path] != null) sel.content = edits[f.path];
          return sel;
        });
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
      <div className="rounded-lg border border-border bg-surface-secondary/30 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl space-y-1">
            <h3 className="text-base font-semibold text-primary">Optimal Files</h3>
            <p className="text-sm text-tertiary">
              Distill this session into a CLAUDE.md, path-scoped rules, hook
              configs, and skill packs. Preview and pick what you want before
              any disk write.
            </p>
          </div>
          <button
            type="button"
            onClick={loadPreview}
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
          >
            Generate
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  function PanelShell({ subtitle, children, trailing }) {
    return (
      <div className="rounded-lg border border-border bg-surface-secondary/30 p-5">
        <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-primary">Optimal Files</h3>
            {subtitle && <p className="mt-0.5 text-sm text-tertiary">{subtitle}</p>}
          </div>
          {trailing}
        </header>
        {children}
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <PanelShell subtitle="Analyzing session and assembling bundle…">
        <p className="text-sm text-tertiary" aria-live="polite">
          This usually takes a couple of seconds.
        </p>
      </PanelShell>
    );
  }

  if (phase === 'error') {
    return (
      <PanelShell subtitle="Bundle generation failed.">
        <div className="rounded-md border border-status-error/30 bg-status-error/5 p-3 text-sm text-status-error">
          {error}
        </div>
        <button
          onClick={() => setPhase('idle')}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-secondary hover:bg-surface-secondary"
        >
          Try again
        </button>
      </PanelShell>
    );
  }

  if (phase === 'done' && manifest) {
    return (
      <PanelShell subtitle="Manifest ready. Run the command below locally.">
        <pre className="overflow-x-auto rounded-md border border-border bg-primary p-3 font-mono text-xs text-primary">
{manifest.apply_command}
        </pre>
        <p className="mt-3 text-xs text-tertiary">
          Expires {new Date(manifest.expires_at).toLocaleString()}. The CLI
          re-runs the secret scan before writing and offers three-way merge for
          files that already exist on disk.
        </p>
      </PanelShell>
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
    <PanelShell
      subtitle="Review and select what to keep. Disabled rows are preview-only placeholders."
      trailing={
        <div className="flex gap-3 text-xs text-tertiary">
          <button onClick={() => setAll(true)} className="hover:text-primary">select all</button>
          <span aria-hidden>·</span>
          <button onClick={() => setAll(false)} className="hover:text-primary">clear</button>
        </div>
      }
    >
      <p className="mb-3 text-xs text-tertiary">
        {bundle.length} suggestion{bundle.length === 1 ? '' : 's'} ·{' '}
        <span className="text-secondary">{acceptedCount} ready for manifest</span>
      </p>

      <div className="space-y-5">
        {orderedGroups.map(([group, items]) => {
          const meta = groupMetaFor(group);
          // Auto-expand the first two manifestable rows in each group so the
          // user sees real content immediately. Disabled (virtual / placeholder)
          // rows are skipped — they don't have content worth showing first.
          const autoExpandPaths = new Set(
            items
              .filter(f => !f.virtual && isManifestablePath(f.path) && (f.content || '').length > 0)
              .slice(0, 2)
              .map(f => f.path),
          );
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
                    defaultOpen={autoExpandPaths.has(f.path)}
                    edited={edits[f.path] ?? null}
                    onEdit={content => handleEdit(f.path, content)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
        <button
          disabled={phase === 'saving' || acceptedCount === 0}
          onClick={createManifest}
          className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-primary disabled:cursor-not-allowed disabled:bg-surface-tertiary disabled:text-tertiary disabled:shadow-none"
        >
          {phase === 'saving' ? 'Creating manifest…' : `Create manifest · ${acceptedCount}`}
          {phase !== 'saving' && acceptedCount > 0 && <ArrowRight className="h-4 w-4" aria-hidden />}
        </button>
        <p className="text-xs text-tertiary">
          Server validates every path against the allowlist before saving.
        </p>
      </div>
    </PanelShell>
  );
}
