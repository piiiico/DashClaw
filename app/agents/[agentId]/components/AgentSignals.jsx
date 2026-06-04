export default function AgentSignals({ signals }) {
  if (!signals || signals.length === 0) return null;

  const redCount = signals.filter(s => s.severity === 'red').length;
  const amberCount = signals.filter(s => s.severity === 'amber').length;

  return (
    <div className="rounded-2xl border border-error/20 bg-surface-secondary px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-widest text-tertiary">Active Signals</span>
        <span className="rounded-full bg-error-subtle px-2 py-0.5 text-[10px] font-semibold text-error">
          {signals.length}
        </span>
        {redCount > 0 && <span className="text-[10px] text-error">{redCount} red</span>}
        {amberCount > 0 && <span className="text-[10px] text-warning">{amberCount} amber</span>}
      </div>
      <div className="space-y-3">
        {signals.map((signal, i) => (
          <div key={signal.type + '-' + i} className="flex items-start gap-3">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${signal.severity === 'red' ? 'bg-status-error' : 'bg-status-warning'}`} />
            <div className="min-w-0">
              <div className="text-sm font-medium text-white">{signal.label}</div>
              <div className="mt-0.5 text-xs text-secondary">{signal.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
