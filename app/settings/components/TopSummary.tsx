import { ActionLink } from './Common';

interface TopSummaryProps {
  view?: any;
  proofDownloadHref?: string;
}

export function TopSummary({ view, proofDownloadHref }: TopSummaryProps) {
  const config = ({
    verified: {
      dot: 'bg-emerald-400',
      border: 'border-emerald-900/40',
      text: 'text-success',
      accent: 'text-success',
    },
    ready_unverified: {
      dot: 'bg-cyan-400',
      border: 'border-cyan-900/40',
      text: 'text-cyan-200',
      accent: 'text-cyan-300',
    },
    needs_attention: {
      dot: 'bg-amber-400',
      border: 'border-amber-900/40',
      text: 'text-amber-200',
      accent: 'text-warning',
    },
    blocked: {
      dot: 'bg-red-400',
      border: 'border-red-900/50',
      text: 'text-red-200',
      accent: 'text-error',
    },
  } as Record<string, any>)[view.verification.overall];

  const checkedAt = view.checkedAt
    ? new Date(view.checkedAt).toLocaleString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        month: 'short',
        day: 'numeric',
      })
    : '';

  return (
    <div className={`rounded-2xl border bg-surface-secondary p-6 ${config.border}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${config.dot}`} />
            <p className={`text-sm font-semibold ${config.accent}`}>{view.verification.label}</p>
          </div>
          <p className="mt-3 text-2xl font-semibold text-white">{view.verification.summary}</p>
          <p className={`mt-2 text-sm ${config.text}`}>
            {view.verification.fullyVerified
              ? 'Core instance checks passed and operator access looks ready.'
              : 'This page separates what has already been verified from live validation that is still pending.'}
          </p>
          <p className="mt-3 text-xs text-tertiary">
            Last checked {checkedAt} (server time)
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <ActionLink href={proofDownloadHref}>Download verification proof</ActionLink>
          <ActionLink href="#workflow" secondary>
            Review verification flow
          </ActionLink>
          <ActionLink href="/settings" secondary>
            Reload checks
          </ActionLink>
        </div>
      </div>
    </div>
  );
}
