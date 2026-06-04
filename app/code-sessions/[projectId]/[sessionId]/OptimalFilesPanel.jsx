'use client';

import { useState } from 'react';
import { ArrowRight, Copy, Check, Pencil, RotateCcw, ChevronRight, ChevronDown, FileText, FileCode2, ShieldCheck, Sparkles, AlertTriangle } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import MarkdownBody from '../../../messages/_components/MarkdownBody';

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
// `.claude/agentlens/` is the legacy prefix, kept for backward-compat.
const ALLOWED_PREFIXES = ['CLAUDE.md', '.claude/dashclaw/', '.claude/agentlens/', '.claude/rules/', '.claude/hooks/', '.claude/skills/'];

function isManifestablePath(p) {
  if (!p) return false;
  if (p.startsWith('(')) return false; // placeholder paths like '(none — ...)' are virtual-only
  if (p.includes('..')) return false;
  return ALLOWED_PREFIXES.some(pref => p === pref || p.startsWith(pref));
}

// Length past which we only show the head of a non-markdown body inline. Copy
// and Edit always operate on the FULL string — this is a display cap only.
const PREVIEW_CHAR_CAP = 4000;
const PREVIEW_LINE_CAP = 10;

// Map a file's path + kind onto a human file-type, the matching code-fence
// language tag, and an icon. Extension wins; `kind` disambiguates rules vs
// skills vs hook configs that share the .md/.py extension space.
function fileTypeFor(file) {
  const path = file.path || '';
  const lower = path.toLowerCase();
  const kind = file.kind || '';
  if (lower.endsWith('.py')) {
    return { type: 'hook config', language: 'python', icon: ShieldCheck, isMarkdown: false };
  }
  if (lower.endsWith('.json')) {
    return { type: 'config', language: 'json', icon: FileCode2, isMarkdown: false };
  }
  if (lower.endsWith('.md')) {
    if (kind.startsWith('skill')) return { type: 'skill', language: 'markdown', icon: Sparkles, isMarkdown: true };
    if (kind === 'path-rules') return { type: 'rules', language: 'markdown', icon: FileText, isMarkdown: true };
    return { type: 'markdown', language: 'markdown', icon: FileText, isMarkdown: true };
  }
  return { type: 'text', language: 'text', icon: FileText, isMarkdown: false };
}

function countStats(content) {
  const chars = content.length;
  const lines = content ? content.split('\n').length : 0;
  const kb = chars / 1024;
  const sizeLabel = kb >= 1 ? `${kb.toFixed(1)} KB` : `${chars} B`;
  return { chars, lines, sizeLabel };
}

// Pull `#`/`##`/`###` headings out of a markdown body for the outline preview.
function markdownOutline(content) {
  const out = [];
  for (const raw of content.split('\n')) {
    const m = /^(#{1,3})\s+(.+?)\s*#*$/.exec(raw);
    if (m) out.push({ depth: m[1].length, text: m[2] });
    if (out.length >= 40) break;
  }
  return out;
}

function ConfidenceBadge({ confidence }) {
  if (!confidence) return null;
  const variant = confidence === 'high' ? 'success' : confidence === 'medium' ? 'default' : 'info';
  return <Badge variant={variant} size="xs" className="uppercase tracking-wide">{confidence}</Badge>;
}

// Styled, labeled code card — distinct from the prose above it. Never raw gray
// soup. Shows a language tag and a head-of-file display cap with a Show-all
// affordance; the underlying string handed to Copy/Edit is always the full one.
function CodeCard({ content, language, isMarkdown }) {
  const [showFull, setShowFull] = useState(false);

  if (isMarkdown) {
    // Markdown bodies render as markdown so a human reads them as the doc they
    // are, not as raw text. Cap by characters for very long bodies.
    const capped = !showFull && content.length > PREVIEW_CHAR_CAP;
    const shown = capped ? content.slice(0, PREVIEW_CHAR_CAP) : content;
    return (
      <div className="overflow-hidden rounded-md border border-border bg-surface-secondary/60">
        <div className="flex items-center gap-2 border-b border-border bg-surface-tertiary px-3 py-1.5">
          <FileText className="h-3 w-3 text-tertiary" aria-hidden />
          <span className="text-[10px] font-medium uppercase tracking-wide text-tertiary">{language}</span>
        </div>
        <div className="px-3 py-3">
          <MarkdownBody content={shown} />
          {capped && (
            <button
              type="button"
              onClick={() => setShowFull(true)}
              className="mt-2 text-[11px] font-medium text-brand hover:underline"
            >
              First {PREVIEW_CHAR_CAP.toLocaleString()} chars shown · show full document
            </button>
          )}
        </div>
      </div>
    );
  }

  const capped = !showFull && content.length > PREVIEW_CHAR_CAP;
  const shown = capped ? content.slice(0, PREVIEW_CHAR_CAP) : content;
  return (
    <div className="overflow-hidden rounded-md border border-border bg-primary">
      <div className="flex items-center gap-2 border-b border-border bg-surface-tertiary px-3 py-1.5">
        <FileCode2 className="h-3 w-3 text-tertiary" aria-hidden />
        <span className="text-[10px] font-medium uppercase tracking-wide text-tertiary">{language}</span>
      </div>
      <pre className="max-h-96 overflow-auto px-3 py-3 font-mono text-[11px] leading-relaxed text-secondary">{shown}</pre>
      {capped && (
        <div className="border-t border-border px-3 py-1.5">
          <button
            type="button"
            onClick={() => setShowFull(true)}
            className="text-[11px] font-medium text-brand hover:underline"
          >
            First {PREVIEW_CHAR_CAP.toLocaleString()} chars shown · Copy copies the full file · show all
          </button>
        </div>
      )}
    </div>
  );
}

// The outline (markdown headings) or head-of-file (non-markdown) tier. Most
// users decide from this plus the reason without ever opening the full body.
function PreviewTier({ content, isMarkdown, lineCount, onShowFull }) {
  if (isMarkdown) {
    const outline = markdownOutline(content);
    if (outline.length === 0) {
      return (
        <button type="button" onClick={onShowFull} className="text-[11px] font-medium text-brand hover:underline">
          Show full file ({lineCount} lines)
        </button>
      );
    }
    return (
      <div>
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-tertiary">Outline</p>
        <ul className="space-y-0.5">
          {outline.map((h, i) => (
            <li
              key={i}
              className="truncate text-xs text-secondary"
              style={{ paddingLeft: `${(h.depth - 1) * 12}px` }}
            >
              <span className="text-tertiary" aria-hidden>{h.depth === 1 ? '#' : h.depth === 2 ? '##' : '###'} </span>
              {h.text}
            </li>
          ))}
        </ul>
        <button type="button" onClick={onShowFull} className="mt-2 text-[11px] font-medium text-brand hover:underline">
          Show full file ({lineCount} lines)
        </button>
      </div>
    );
  }
  const head = content.split('\n').slice(0, PREVIEW_LINE_CAP).join('\n');
  const more = lineCount > PREVIEW_LINE_CAP;
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-tertiary">
        First {Math.min(PREVIEW_LINE_CAP, lineCount)} lines
      </p>
      <pre className="overflow-auto rounded-md border border-border bg-primary px-3 py-2 font-mono text-[11px] leading-relaxed text-secondary">{head}</pre>
      {more && (
        <button type="button" onClick={onShowFull} className="mt-2 text-[11px] font-medium text-brand hover:underline">
          Show full file ({lineCount} lines)
        </button>
      )}
    </div>
  );
}

function ReasonLine({ label, value }) {
  if (!value) return null;
  return (
    <p className="text-xs leading-relaxed text-secondary">
      <span className="font-medium text-tertiary">{label} · </span>
      {value}
    </p>
  );
}

function FileRow({ file, selected, onToggle, disabled, edited, onEdit }) {
  const [open, setOpen] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const baseContent = file.content || '';
  const currentContent = edited != null ? edited : baseContent;
  const isEdited = edited != null && edited !== baseContent;
  const hasContent = baseContent.length > 0;

  const meta = fileTypeFor(file);
  const TypeIcon = meta.icon;
  const { lines, sizeLabel } = countStats(currentContent);

  const secretFindings = file.secret_scan?.findings || [];
  const overwrite = file.overwrite_risk;
  const showOverwriteChip = overwrite && overwrite !== 'unknown' && overwrite !== 'n/a';
  const overwriteVariant = overwrite === 'conflict' ? 'warning' : overwrite === 'new' ? 'success' : 'default';

  async function handleCopy() {
    try {
      // Always copy the FULL current content — never the display-capped slice.
      await navigator.clipboard.writeText(currentContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable in non-secure contexts.
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
          {/* Collapsed summary — clickable to expand */}
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="flex w-full items-start gap-2 text-left"
            aria-expanded={open}
          >
            <span aria-hidden className="mt-0.5 text-tertiary">
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <code className="truncate font-mono text-xs text-primary">{file.path}</code>
                <Badge variant="info" size="xs" className="gap-1">
                  <TypeIcon className="h-2.5 w-2.5" aria-hidden />
                  {meta.type}
                </Badge>
                {hasContent && (
                  <span className="text-[10px] tabular-nums text-tertiary">{lines} lines · {sizeLabel}</span>
                )}
                <ConfidenceBadge confidence={file.confidence} />
                {isEdited && <Badge variant="warning" size="xs">edited</Badge>}
                {disabled && <Badge variant="default" size="xs">preview only</Badge>}
                {secretFindings.length > 0 && (
                  <Badge variant="warning" size="xs" className="gap-1">
                    <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                    {secretFindings.length} redaction{secretFindings.length === 1 ? '' : 's'}
                  </Badge>
                )}
              </div>
              {file.reason && (
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-tertiary">{file.reason}</p>
              )}
            </div>
          </button>

          {open && (
            <div className="ml-5 mt-3 space-y-3">
              {!hasContent ? (
                <p className="text-xs italic text-tertiary">No content — virtual placeholder.</p>
              ) : (
                <>
                  {/* File header bar */}
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-tertiary px-3 py-2">
                    <TypeIcon className="h-3.5 w-3.5 shrink-0 text-tertiary" aria-hidden />
                    <code className="truncate font-mono text-[11px] text-primary">{file.path}</code>
                    <Badge variant="info" size="xs">{meta.type}</Badge>
                    <span className="text-[10px] tabular-nums text-tertiary">{lines} lines · {sizeLabel}</span>
                    {showOverwriteChip && (
                      <Badge variant={overwriteVariant} size="xs">{overwrite}</Badge>
                    )}
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
                          onClick={() => onEdit(null)}
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

                  {/* Reasoning prose */}
                  <div className="space-y-1">
                    <ReasonLine label="Why" value={file.reason} />
                    <ReasonLine label="Commit" value={file.commit_recommendation} />
                    {showOverwriteChip && <ReasonLine label="Overwrite risk" value={overwrite} />}
                  </div>

                  {secretFindings.length > 0 && (
                    <div className="rounded-md border border-status-warning/30 bg-status-warning/5 p-2 text-xs text-status-warning">
                      Secret scan redacted: {secretFindings.map(f => f.kind || f.label || 'secret').join(', ')}
                    </div>
                  )}

                  {/* Body: edit textarea, full code card, or preview tier */}
                  {editing ? (
                    <textarea
                      value={currentContent}
                      onChange={e => onEdit(e.target.value)}
                      spellCheck={false}
                      rows={Math.min(28, Math.max(8, currentContent.split('\n').length + 1))}
                      className="block w-full resize-y rounded-md border border-border bg-primary p-3 font-mono text-[11px] leading-relaxed text-primary focus:border-border-active focus:outline-none focus:ring-1 focus:ring-brand/30"
                    />
                  ) : showFull ? (
                    <div className="space-y-2">
                      <CodeCard content={currentContent} language={meta.language} isMarkdown={meta.isMarkdown} />
                      <button
                        type="button"
                        onClick={() => setShowFull(false)}
                        className="text-[11px] font-medium text-brand hover:underline"
                      >
                        Collapse to outline
                      </button>
                    </div>
                  ) : (
                    <PreviewTier
                      content={currentContent}
                      isMarkdown={meta.isMarkdown}
                      lineCount={lines}
                      onShowFull={() => setShowFull(true)}
                    />
                  )}
                </>
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
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
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
      subtitle="Review and select what to keep. Rows start collapsed — expand to see the outline, then the full file. Disabled rows are preview-only placeholders."
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
          className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-primary disabled:cursor-not-allowed disabled:bg-surface-tertiary disabled:text-tertiary disabled:shadow-none"
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
