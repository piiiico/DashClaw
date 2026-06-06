'use client';

import { useState, useEffect } from 'react';
import PageLayout from '../../components/PageLayout';

const fmt = (n: any, cur?: string) => `${Number(n || 0).toFixed(4)} ${cur || 'USDC'}`;
const STATUS_TONE: Record<string, string> = {
  succeeded: 'text-success', approved: 'text-secondary', pending: 'text-warning', failed: 'text-error', blocked: 'text-error',
};

export default function X402PurchasesPage() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/x402/purchases');
        if (res.ok) setRows((await res.json()).purchases || []);
      } catch (err) {
        console.error('Failed to load x402 purchases:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <PageLayout title="x402 Purchases" subtitle="Governed capability purchases" breadcrumbs={['Spend', 'Purchases']} maturity="beta">
      {loading ? (
        <div className="text-sm text-tertiary">Loading…</div>
      ) : !rows || rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-secondary p-8 text-center text-sm text-tertiary">
          No governed purchases yet.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface-secondary overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-tertiary border-b border-border">
                <th className="text-left font-medium px-4 py-3">Provider</th>
                <th className="text-left font-medium px-4 py-3">Agent</th>
                <th className="text-right font-medium px-4 py-3">Spend</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-left font-medium px-4 py-3">Reason</th>
                <th className="text-left font-medium px-4 py-3">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.action_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{r.provider_id || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.agent_id || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmt(r.spend_amount, r.currency)}</td>
                  <td className={`px-4 py-3 ${STATUS_TONE[r.execution_status] || 'text-secondary'}`}>{r.execution_status || '—'}</td>
                  <td className="px-4 py-3 text-secondary max-w-xs truncate" title={r.purchase_reason || ''}>{r.purchase_reason || '—'}</td>
                  <td className="px-4 py-3 text-tertiary tabular-nums">{r.created_at ? String(r.created_at).slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageLayout>
  );
}
