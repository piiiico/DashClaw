import { useState } from 'react';

export default function PolicyGeneratedAdvancedDetails({ advancedDetails, rawPolicy }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-white/[0.02] p-4">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="text-sm font-medium text-warning"
      >
        Advanced details
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          {advancedDetails && (
            <div>
              <div className="mb-2 text-xs uppercase tracking-wider text-tertiary">Normalized advanced details</div>
              <pre className="overflow-x-auto rounded-lg bg-surface-secondary p-3 text-xs text-secondary">
                {JSON.stringify(advancedDetails, null, 2)}
              </pre>
            </div>
          )}
          {rawPolicy && (
            <div>
              <div className="mb-2 text-xs uppercase tracking-wider text-tertiary">Raw generated policy</div>
              <pre className="overflow-x-auto rounded-lg bg-surface-secondary p-3 text-xs text-secondary">
                {JSON.stringify(rawPolicy, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
