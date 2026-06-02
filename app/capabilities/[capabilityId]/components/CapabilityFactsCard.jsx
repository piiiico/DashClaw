import { Card, CardContent, CardHeader } from '../../../components/ui/Card';

function FactRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-tertiary">{label}</span>
      <span className="text-white text-right">{value}</span>
    </div>
  );
}

export default function CapabilityFactsCard({ capability, health }) {
  const estCost = capability?.pricing?.estimated_cost_usd;
  const docsUrl = capability?.docs_url;
  return (
    <Card hover={false}>
      <CardHeader title="Facts" />
      <CardContent className="space-y-2 text-sm">
        <FactRow label="Source type" value={capability?.source_type || 'unknown'} />
        <FactRow label="Auth type" value={capability?.auth_type || 'none'} />
        <FactRow label="Approval required" value={capability?.requires_approval ? 'Yes' : 'No'} />
        <FactRow label="Stale check" value={health?.stale_check ? 'Stale' : 'Fresh'} />
        {estCost != null && estCost !== '' && (
          <FactRow label="Est. cost / invocation" value={`$${Number(estCost).toFixed(4)}`} />
        )}
        {docsUrl && (
          <FactRow
            label="Docs"
            value={
              <a href={docsUrl} target="_blank" rel="noreferrer" className="text-brand hover:text-brand/80 underline">
                View docs
              </a>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
