import { Badge } from './ui/Badge';

const VARIANT_BY_STATUS: Record<string, string> = {
  pending: 'info',
  completed: 'success',
  partial: 'warning',
  failed: 'error',
  lost_confirmation: 'default',
};

const LABEL_BY_STATUS: Record<string, string> = {
  pending: 'Pending',
  completed: 'Completed',
  partial: 'Partial',
  failed: 'Failed',
  lost_confirmation: 'Lost',
};

interface OutcomeBadgeProps {
  status?: string;
  size?: string;
  className?: string;
}

export function OutcomeBadge({ status, size = 'xs', className = '' }: OutcomeBadgeProps) {
  if (!status) return null;
  const variant = VARIANT_BY_STATUS[status] || 'default';
  const label = LABEL_BY_STATUS[status] || status;
  const pulse = status === 'pending' ? 'animate-pulse' : '';
  return (
    <Badge variant={variant} size={size} className={`${pulse} ${className}`.trim()}>
      {label}
    </Badge>
  );
}
