import { CodeBlock } from './Common';

interface RecommendedStepsProps {
  recommendations?: any[];
}

export function RecommendedSteps({ recommendations }: RecommendedStepsProps) {
  if (!recommendations?.length) return null;

  return (
    <div className="mt-8">
      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-tertiary">Recommended next steps</p>
      <div className="space-y-3">
        {recommendations.map((step) => (
          <ActionBlock key={step.id} step={step} />
        ))}
      </div>
    </div>
  );
}

interface ActionBlockProps {
  step?: any;
}

function ActionBlock({ step }: ActionBlockProps) {
  const borderColor = ({
    error: 'border-red-900/50',
    warn: 'border-amber-900/50',
    info: 'border-border-hover',
  } as Record<string, string>)[step.variant] || 'border-border-hover';

  const titleColor = ({
    error: 'text-error',
    warn: 'text-warning',
    info: 'text-secondary',
  } as Record<string, string>)[step.variant] || 'text-secondary';

  return (
    <div className={`rounded-2xl border bg-surface-secondary p-5 ${borderColor}`}>
      <p className={`mb-2 text-sm font-semibold ${titleColor}`}>{step.title}</p>
      <p className="text-sm text-secondary">{step.summary}</p>
      {step.details?.length ? (
        <div className="mt-3 space-y-1">
          {step.details.map((detail: any) => (
            <p key={detail} className="text-xs text-tertiary">
              {detail}
            </p>
          ))}
        </div>
      ) : null}
      {step.code ? (
        <div className="mt-3">
          <CodeBlock>{step.code}</CodeBlock>
        </div>
      ) : null}
      {step.note ? <p className="mt-3 text-xs text-tertiary">{step.note}</p> : null}
    </div>
  );
}
