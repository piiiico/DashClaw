interface WorkflowPanelProps {
  workflow?: any[];
}

export function WorkflowPanel({ workflow }: WorkflowPanelProps) {
  const allPass = (workflow as any[]).every((step) => step.status === 'pass');

  return (
    <details
      id="workflow"
      open={!allPass}
      className="group rounded-2xl border border-border bg-surface-secondary"
    >
      <summary className="flex cursor-pointer items-center gap-3 px-5 py-4 select-none list-none [&::-webkit-details-marker]:hidden">
        {allPass ? (
          <span className="shrink-0 text-xs font-bold text-success">OK</span>
        ) : (
          <span className="shrink-0 text-xs font-bold text-secondary">&#8943;</span>
        )}
        <p className="min-w-0 flex-1 text-sm font-semibold text-secondary">Verification workflow</p>
        {allPass && (
          <span className="rounded-full border border-emerald-900/40 bg-emerald-900/10 px-2.5 py-0.5 text-[10px] text-success">
            All steps complete
          </span>
        )}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-tertiary transition-transform group-open:rotate-180"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>

      <div className="space-y-3 px-5 pb-5 pt-1">
        {(workflow as any[]).map((step, index) => (
          <WorkflowStep key={step.id} step={step} index={index} />
        ))}
      </div>
    </details>
  );
}

interface WorkflowStepProps {
  step?: any;
  index?: number;
}

function WorkflowStep({ step, index }: WorkflowStepProps) {
  const styles = ({
    pass: 'border-emerald-900/40 text-success',
    warn: 'border-amber-900/40 text-warning',
    fail: 'border-red-900/40 text-error',
    blocked: 'border-red-900/40 text-error',
    pending: 'border-cyan-900/40 text-cyan-300',
  } as Record<string, string>)[step.status] || 'border-border-hover text-secondary';

  return (
    <div className={`rounded-xl border bg-surface-tertiary p-4 ${styles}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-[11px] font-semibold">
          {(index as number) + 1}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{step.title}</p>
          <p className="mt-1 text-xs text-secondary">{step.summary}</p>
          <p className="mt-2 text-xs text-tertiary">Proof: {step.proof}</p>
          {step.nextAction ? <p className="mt-1 text-xs text-secondary">Next action: {step.nextAction}</p> : null}
        </div>
      </div>
    </div>
  );
}
