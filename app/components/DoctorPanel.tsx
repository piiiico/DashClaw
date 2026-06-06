'use client';

import { useCallback, useEffect, useState } from 'react';
import { Stethoscope, RotateCw, Wrench } from 'lucide-react';
import { Card, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { ListSkeleton } from './ui/Skeleton';

// Operator surface for the diagnostics engine:
//   GET  /api/doctor          → { status, summary:{pass,warn,fail}, checks[] }
//   POST /api/doctor/fix      → applies a named auto-fix, returns { ...result, recheck }
// Each check: { id, category, status: 'pass'|'warn'|'fail', title, message, fix }
// fix (when fixable): { type: 'auto'|'manual', description, action }

const STATUS_VARIANT: Record<string, string> = { pass: 'success', warn: 'warning', fail: 'error' };

function groupByCategory(checks: any[]): [string, any[]][] {
  const groups = new Map<string, any[]>();
  for (const check of checks) {
    const key = check.category || 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(check);
  }
  return [...groups.entries()];
}

export default function DoctorPanel() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fixingAction, setFixingAction] = useState<string | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/doctor');
      const body = await res.json().catch(() => ({}));
      // A non-2xx here means status === 'unhealthy' but the body still holds checks.
      if (body.checks) {
        setData(body);
      } else {
        setError(body.error || 'Failed to run diagnostics');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to run diagnostics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const applyFix = async (action: string) => {
    setFixingAction(action);
    setFixError(null);
    try {
      const res = await fetch('/api/doctor/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFixError(body.error || 'Fix failed');
        return;
      }
      if (body.recheck?.checks) setData(body.recheck);
    } catch (err: any) {
      setFixError(err.message || 'Fix failed');
    } finally {
      setFixingAction(null);
    }
  };

  if (loading && !data) {
    return <ListSkeleton rows={5} />;
  }

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-error/20 bg-error-subtle px-4 py-3 text-sm text-error">
        {error}
      </div>
    );
  }

  const summary = data?.summary || { pass: 0, warn: 0, fail: 0 };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Stethoscope size={16} className="text-brand" aria-hidden="true" />
          <Badge variant="success" size="xs">{summary.pass} pass</Badge>
          <Badge variant="warning" size="xs">{summary.warn} warn</Badge>
          <Badge variant="error" size="xs">{summary.fail} fail</Badge>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-secondary transition-colors hover:border-border-hover hover:text-white disabled:opacity-50"
        >
          <RotateCw size={14} aria-hidden="true" /> {loading ? 'Re-checking…' : 'Re-run'}
        </button>
      </div>

      {fixError && (
        <div role="alert" className="rounded-lg border border-error/20 bg-error-subtle px-3 py-2 text-sm text-error">{fixError}</div>
      )}

      {groupByCategory(data?.checks || []).map(([category, checks]) => (
        <Card key={category} hover={false}>
          <div className="border-b border-border px-5 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">{category}</span>
          </div>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {checks.map((check) => {
                const fixable = check.fix && check.fix.type === 'auto' && check.fix.action;
                return (
                  <li key={check.id} className="flex items-start gap-3 px-5 py-3">
                    <Badge variant={STATUS_VARIANT[check.status] || 'info'} size="xs">{check.status}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-secondary">{check.title}</div>
                      {check.message && <p className="mt-0.5 text-xs text-tertiary">{check.message}</p>}
                      {check.fix && check.fix.type !== 'auto' && check.fix.description && (
                        <p className="mt-1 text-xs text-secondary">Fix: {check.fix.description}</p>
                      )}
                    </div>
                    {fixable && (
                      <button
                        onClick={() => applyFix(check.fix.action)}
                        disabled={fixingAction === check.fix.action}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
                        title={check.fix.description || 'Apply fix'}
                      >
                        <Wrench size={12} aria-hidden="true" />
                        {fixingAction === check.fix.action ? 'Fixing…' : 'Fix'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
