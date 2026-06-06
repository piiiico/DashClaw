import Link from 'next/link';
import { Activity, FlaskConical, Pencil, RotateCw } from 'lucide-react';
import { Card, CardContent, CardHeader } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';

const healthVariant: Record<string, string> = {
  healthy: 'success',
  degraded: 'warning',
  failing: 'error',
  untested: 'default',
  unknown: 'default',
};

const certificationVariant: Record<string, string> = {
  certified: 'success',
  failed: 'error',
  uncertified: 'warning',
};

interface CapabilityStatusHeroProps {
  capability?: any;
  health?: any;
  loading?: boolean;
  onRefresh: () => void;
  onOpenTest: () => void;
}

export default function CapabilityStatusHero({ capability, health, loading, onRefresh, onOpenTest }: CapabilityStatusHeroProps) {
  const canTest = capability?.source_type === 'http_api' && typeof capability?.invocation_schema?.endpoint === 'string';
  const capabilityId = capability?.capability_id;

  return (
    <Card hover={false}>
      <CardHeader
        title="Capability"
        icon={Activity}
        action={(
          <div className="flex items-center gap-2">
            {canTest ? (
              <button
                onClick={onOpenTest}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white transition-colors hover:bg-white/10"
              >
                <FlaskConical size={14} />
                Run Test
              </button>
            ) : null}
            {capabilityId ? (
              <Link
                href={`/capabilities/${capabilityId}/edit`}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-secondary transition-colors hover:text-white"
              >
                <Pencil size={14} />
                Edit
              </Link>
            ) : null}
            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-surface-tertiary px-3 py-1.5 text-sm text-secondary transition-colors hover:text-white"
            >
              <RotateCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        )}
      />
      <CardContent className="space-y-3">
        <div>
          <div className="text-xl font-semibold text-white">{capability?.name}</div>
          <div className="text-xs text-tertiary font-mono mt-1">{capability?.slug}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={healthVariant[health?.status] || 'default'}>{health?.status || 'unknown'}</Badge>
          <Badge variant={certificationVariant[health?.certification_status] || 'default'}>
            {health?.certification_status || 'uncertified'}
          </Badge>
          {capability?.risk_level ? <Badge variant="info">{capability.risk_level}</Badge> : null}
          {capability?.source_type ? <Badge>{capability.source_type}</Badge> : null}
        </div>
      </CardContent>
    </Card>
  );
}
