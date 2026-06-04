'use client';

export default function WorkflowReferenceHelp() {
  return (
    <div className="rounded-xl border border-border bg-white/[0.02] p-4 space-y-3">
      <div className="text-xs font-medium text-secondary uppercase tracking-wider">Reference help</div>
      <p className="text-sm text-secondary">
        Use the variable inserters to pull workflow inputs and outputs from earlier steps into later search queries, capability payloads, and prompts.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-[10px] uppercase tracking-wider text-tertiary">Workflow input</div>
          <div className="mt-1 text-xs font-mono text-secondary">${'{variables.input_name}'}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-[10px] uppercase tracking-wider text-tertiary">Previous step output</div>
          <div className="mt-1 text-xs font-mono text-secondary">${'{steps.step_1.output.text}'}</div>
        </div>
      </div>
    </div>
  );
}
