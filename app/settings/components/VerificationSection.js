export function VerificationSection({ section }) {
  const allPass = section.checks.every((c) => c.status === 'pass');
  const headerColor = {
    pass: 'text-success',
    fail: 'text-error',
    warn: 'text-warning',
    info: 'text-cyan-300',
  }[section.status] || 'text-secondary';

  const icon = {
    pass: 'OK',
    fail: '!!',
    warn: '!',
    info: 'i',
  }[section.status] || 'i';

  return (
    <details
      open={!allPass}
      className="group overflow-hidden rounded-2xl border border-border bg-surface-secondary"
    >
      <summary className="flex cursor-pointer items-center gap-3 px-5 py-4 select-none list-none [&::-webkit-details-marker]:hidden">
        <span className={`shrink-0 text-xs font-bold ${headerColor}`}>{icon}</span>
        <p className="min-w-0 flex-1 text-sm font-semibold text-secondary">{section.title}</p>
        {allPass && (
          <span className="rounded-full border border-emerald-900/40 bg-emerald-900/10 px-2.5 py-0.5 text-[10px] text-success">
            All checks passed
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

      {section.description && (
        <div className="border-t border-border px-5 py-3">
          <p className="text-xs text-tertiary">{section.description}</p>
          {section.summary && <p className="mt-1 text-sm text-secondary">{section.summary}</p>}
          {section.whatWasChecked && (
            <p className="mt-1 text-xs text-secondary">What was checked: {section.whatWasChecked}</p>
          )}
          {section.evidenceSummary && (
            <p className="mt-1 text-xs text-tertiary">Evidence: {section.evidenceSummary}</p>
          )}
          {section.pendingProof && (
            <p className="mt-1 text-xs text-tertiary">Still pending: {section.pendingProof}</p>
          )}
        </div>
      )}

      <div className="divide-y divide-border">
        {section.checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}

        {section.id === 'sdk' ? (
          <SdkValidationNote coreReady={section.coreReady} liveProof={section.liveProof} />
        ) : null}
      </div>
    </details>
  );
}

function CheckRow({ check }) {
  const icon = {
    pass: 'OK',
    fail: '!!',
    warn: '!',
    info: 'i',
  }[check.status] || 'i';

  const iconColor = {
    pass: 'text-success',
    fail: 'text-error',
    warn: 'text-warning',
    info: 'text-cyan-300',
  }[check.status] || 'text-tertiary';

  return (
    <div className="px-5 py-4">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 w-4 shrink-0 text-xs font-bold ${iconColor}`}>{icon}</span>
        <div className="min-w-0">
          <p className="text-sm text-secondary">{check.label}</p>
          {check.detail ? <p className="mt-0.5 text-xs text-secondary">{check.detail}</p> : null}
          {check.subDetail ? <p className="mt-1 text-xs text-tertiary">{check.subDetail}</p> : null}
          {check.likelyCause ? <p className="mt-2 text-xs text-tertiary">Likely cause: {check.likelyCause}</p> : null}
          {check.nextAction ? <p className="mt-1 text-xs text-secondary">Next action: {check.nextAction}</p> : null}
        </div>
      </div>
    </div>
  );
}

function SdkValidationNote({ coreReady, liveProof }) {
  if (liveProof) {
    return (
      <div className="px-5 py-4">
        <div className="rounded-xl border border-emerald-900/40 bg-surface-tertiary p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-success">Live proof captured</p>
          <p className="mt-2 text-xs text-secondary">{liveProof.proofStatement}</p>
          <p className="mt-1 text-xs text-tertiary">
            Captured {new Date(liveProof.capturedAt).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 py-4">
      <p className="text-xs text-tertiary">
        {coreReady
          ? 'Use the "Run test" button above to validate your API key and capture live proof automatically.'
          : 'Fix the blocked core checks above first, then use the test button to validate.'}
      </p>
    </div>
  );
}
