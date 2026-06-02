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
  // docs_url is operator-supplied; only render it as a link when it's a real
  // http(s) URL. A raw href would otherwise let a javascript:/data:/vbscript:
  // scheme through and execute on click (stored XSS).
  const safeDocsUrl = (() => {
    const raw = capability?.docs_url;
    if (!raw) return null;
    try {
      const u = new URL(raw);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
    } catch {
      return null;
    }
  })();
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
        {safeDocsUrl && (
          <FactRow
            label="Docs"
            value={
              <a href={safeDocsUrl} target="_blank" rel="noreferrer noopener" className="text-brand hover:text-brand/80 underline">
                View docs
              </a>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
