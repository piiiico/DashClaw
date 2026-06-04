'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="rounded-lg border border-border-hover bg-surface-tertiary px-3 py-2 text-xs shadow-xl">
      <div className="text-secondary mb-1">{d.date}</div>
      <div className="text-success">Completed: {d.completed}</div>
      <div className="text-error">Failed: {d.failed}</div>
      <div className="text-warning">Blocked: {d.blocked}</div>
      <div className="text-secondary">Other: {d.other}</div>
    </div>
  );
}

export default function ActionVolumeChart({ daily }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-secondary p-5">
      <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-4">Action Volume</div>
      {daily.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-sm text-tertiary">No actions in this period.</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={daily} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.slice(5)} />
            <YAxis tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} width={35} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="completed" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} />
            <Bar dataKey="failed" stackId="a" fill="#ef4444" />
            <Bar dataKey="blocked" stackId="a" fill="#eab308" />
            <Bar dataKey="other" stackId="a" fill="#52525b" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
