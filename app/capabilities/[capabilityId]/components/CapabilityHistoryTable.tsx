import Link from 'next/link';
import { Card, CardContent, CardHeader } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';

const ACTION_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All actions' },
  { value: 'capability_test', label: 'Capability tests' },
  { value: 'capability_invoke', label: 'Capability invokes' },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'running', label: 'Running' },
  { value: 'pending_approval', label: 'Pending approval' },
];

function statusVariant(status: string): string {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'pending_approval') return 'warning';
  return 'default';
}

interface HistoryFilters {
  actionType: string;
  status: string;
  [key: string]: any;
}

interface CapabilityHistoryTableProps {
  events: any[];
  filters: HistoryFilters;
  loading?: boolean;
  error?: string | null;
  onFiltersChange: (patch: Partial<HistoryFilters>) => void;
  onRetry: () => void;
}

export default function CapabilityHistoryTable({
  events,
  filters,
  loading,
  error,
  onFiltersChange,
  onRetry,
}: CapabilityHistoryTableProps) {
  return (
    <Card hover={false}>
      <CardHeader title="Recent History" count={events.length} />
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row">
          <label className="flex flex-col gap-1 text-xs text-tertiary">
            <span>Action type</span>
            <select
              aria-label="Action type filter"
              value={filters.actionType}
              onChange={(event) => onFiltersChange({ actionType: event.target.value })}
              className="rounded-lg border border-white/10 bg-surface-tertiary px-3 py-2 text-sm text-white"
            >
              {ACTION_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-tertiary">
            <span>Status</span>
            <select
              aria-label="Status filter"
              value={filters.status}
              onChange={(event) => onFiltersChange({ status: event.target.value })}
              className="rounded-lg border border-white/10 bg-surface-tertiary px-3 py-2 text-sm text-white"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        {loading ? (
          <div className="text-sm text-tertiary">Refreshing history...</div>
        ) : error ? (
          <div className="space-y-3">
            <div className="text-sm text-error">{error}</div>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-surface-tertiary px-3 py-1.5 text-sm text-secondary transition-colors hover:text-white"
            >
              Retry History
            </button>
          </div>
        ) : events.length === 0 ? (
          <div className="text-sm text-tertiary">No recent capability events.</div>
        ) : (
          <div className="space-y-2">
            {events.map((event) => {
              const content = (
                <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm text-white">{event.action_type}</div>
                    <Badge size="xs" variant={statusVariant(event.status)}>
                      {event.status}
                    </Badge>
                  </div>
                  {event.action_id ? (
                    <div className="text-xs text-tertiary font-mono mt-1">{event.action_id}</div>
                  ) : null}
                </div>
              );

              if (event.action_id) {
                return (
                  <Link key={event.action_id} href={`/decisions/${event.action_id}`} className="block">
                    {content}
                  </Link>
                );
              }

              return (
                <div key={`${event.action_type}-${event.status}`}>
                  {content}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
