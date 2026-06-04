import { Badge } from '../../../components/ui/Badge';
import { Fingerprint, Lock, ShieldCheck, ShieldAlert, Shield } from 'lucide-react';

const permissionVariant = {
  danger: 'error',
  workspace_write: 'warning',
  prompt: 'info',
  allow: 'success',
  readonly: 'default',
  unknown: 'default',
};

export default function AgentTrustPosture({ trust }) {
  const approvalPct = trust.approval_record.total > 0
    ? Math.round((trust.approval_record.allowed / trust.approval_record.total) * 100)
    : null;
  const approvalVariant = approvalPct === null ? 'default' : approvalPct >= 80 ? 'success' : approvalPct >= 50 ? 'warning' : 'error';

  return (
    <div className="rounded-2xl border border-border bg-surface-secondary px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <Shield size={14} className="text-tertiary" />
        <span className="text-xs font-medium uppercase tracking-widest text-tertiary">Trust Posture</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={permissionVariant[trust.permission_level] || 'default'} size="xs">
          Permission: {trust.permission_level}
        </Badge>
        <Badge variant={trust.identity_verified ? 'success' : 'default'} size="xs">
          <Fingerprint size={10} className="mr-1" />
          {trust.identity_verified ? 'Verified' : 'Unsigned'}
        </Badge>
        <Badge variant={trust.signature_enforced ? 'success' : 'default'} size="xs">
          <Lock size={10} className="mr-1" />
          Signature: {trust.signature_enforced ? 'Enforced' : 'Optional'}
        </Badge>
        <Badge variant="info" size="xs">
          <ShieldCheck size={10} className="mr-1" />
          {trust.active_policies_count} {trust.active_policies_count === 1 ? 'policy' : 'policies'}
        </Badge>
        {trust.approval_record.total > 0 && (
          <Badge variant={approvalVariant} size="xs">
            Approvals: {trust.approval_record.allowed} of {trust.approval_record.total}
            {approvalPct !== null && ` (${approvalPct}%)`}
          </Badge>
        )}
        {trust.blocks_30d > 0 && (
          <Badge variant="error" size="xs">
            <ShieldAlert size={10} className="mr-1" />
            {trust.blocks_30d} blocked (30d)
          </Badge>
        )}
      </div>
    </div>
  );
}
