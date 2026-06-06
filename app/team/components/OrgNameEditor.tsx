'use client';

import { useState } from 'react';
import { Pencil, Check, X } from 'lucide-react';

interface OrgNameEditorProps {
  orgId: string;
  name: string;
  isAdmin?: boolean;
  onRenamed?: (name: string) => void;
}

/**
 * Inline workspace (org) rename. Wires the previously-unused
 * PATCH /api/orgs/[orgId] {name}. Admin-gated by the caller (isAdmin).
 */
export default function OrgNameEditor({ orgId, name, isAdmin, onRenamed }: OrgNameEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const next = value.trim();
    if (!next || next === name) { setEditing(false); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onRenamed?.(data.organization?.name ?? next);
        setEditing(false);
      } else {
        setError(data.error || 'Rename failed');
      }
    } catch {
      setError('Rename failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 rounded-xl border border-border bg-surface-secondary px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Workspace name</div>
      {editing ? (
        <div className="mt-1.5 flex items-center gap-2">
          <label htmlFor="org-name-input" className="sr-only">Workspace name</label>
          <input
            id="org-name-input"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setValue(name); } }}
            autoFocus
            maxLength={256}
            className="rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-white focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <button
            onClick={save}
            disabled={saving}
            aria-label="Save"
            className="rounded p-1.5 text-tertiary transition-colors hover:bg-white/5 hover:text-success disabled:opacity-50"
          >
            <Check size={15} />
          </button>
          <button
            onClick={() => { setEditing(false); setValue(name); setError(null); }}
            aria-label="Cancel rename"
            className="rounded p-1.5 text-tertiary transition-colors hover:bg-white/5 hover:text-white"
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-sm font-medium text-white">{name}</span>
          {isAdmin && (
            <button
              onClick={() => { setValue(name); setEditing(true); }}
              aria-label="Rename workspace"
              className="rounded p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-white"
            >
              <Pencil size={13} />
            </button>
          )}
        </div>
      )}
      {error && <div className="mt-1.5 text-xs text-error">{error}</div>}
    </div>
  );
}
