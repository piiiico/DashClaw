interface CapabilitySummaryCardProps {
  mode: string;
  form: {
    name?: string;
    source_type: string;
    risk_level: string;
    requires_approval: boolean;
    [key: string]: any;
  };
  runtime: {
    method?: string;
    endpoint?: string;
    retry_policy?: { max_retries?: number; backoff?: string; [key: string]: any };
    circuit_breaker?: { enabled?: boolean; consecutive_failures?: number; [key: string]: any };
    [key: string]: any;
  };
  fieldCount: number;
}

export default function CapabilitySummaryCard({ mode, form, runtime, fieldCount }: CapabilitySummaryCardProps) {
  const runtimeSummary = mode === 'runnable_http'
    ? `Runnable over ${runtime.method} ${runtime.endpoint || 'endpoint not set'}`
    : `Registry-only ${form.source_type.replace(/_/g, ' ')}`;

  return (
    <div className="rounded-xl border border-white/10 bg-surface-tertiary/40 p-4 space-y-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-secondary">Summary</p>
        <p className="mt-1 text-sm text-white">{form.name || 'Untitled capability'}</p>
      </div>
      <p className="text-sm text-secondary">{runtimeSummary}</p>
      <ul className="space-y-1 text-sm text-tertiary">
        <li>Risk: {form.risk_level}</li>
        <li>Approval: {form.requires_approval ? 'Required' : 'Not required'}</li>
        <li>Input fields: {fieldCount}</li>
        {mode === 'runnable_http' ? (
          <li>Retry: {(runtime?.retry_policy?.max_retries || 0) > 0
            ? `${runtime.retry_policy!.max_retries}x ${runtime.retry_policy!.backoff || 'none'}`
            : 'disabled'}</li>
        ) : null}
        {mode === 'runnable_http' ? (
          <li>Circuit breaker: {runtime?.circuit_breaker?.enabled
            ? `${runtime.circuit_breaker.consecutive_failures || 5} failures`
            : 'disabled'}</li>
        ) : null}
      </ul>
    </div>
  );
}
