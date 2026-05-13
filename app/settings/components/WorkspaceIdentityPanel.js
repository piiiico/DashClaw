'use client';

import { useCallback, useState } from 'react';
import { Copy, CheckCircle2 } from 'lucide-react';

/**
 * Shows operators their workspace identity values: org id, org name,
 * org slug (if set), and user id. Each value has a copy button.
 *
 * Operators need these specifically for integration setup. The Discord
 * bot wants DISCORD_APPROVER_ORG_ID. Telegram and webhook setup want
 * the same. None of those values were surfaced in the dashboard before;
 * operators had to query the database directly. This panel removes that
 * step.
 *
 * Renders nothing when org id is missing (unauthenticated server miss).
 */
export default function WorkspaceIdentityPanel({ orgId, orgName, orgSlug, orgPlan, userId }) {
  if (!orgId) return null;

  return (
    <div className="rounded-xl border border-border bg-surface-secondary p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
          Workspace identity
        </div>
        {orgPlan ? (
          <span className="rounded-md border border-border bg-surface-tertiary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-tertiary">
            {orgPlan}
          </span>
        ) : null}
      </div>
      <p className="mb-4 text-xs text-tertiary leading-relaxed">
        Use these values when configuring integrations that need to know which workspace an alert belongs to (Discord bot, Telegram bot, webhooks).
      </p>
      <div className="space-y-3">
        <IdentityField label="Org ID" value={orgId} mono />
        <IdentityField label="Org name" value={orgName || '(unnamed)'} />
        {orgSlug ? <IdentityField label="Org slug" value={orgSlug} mono /> : null}
        <IdentityField
          label="Your user ID"
          value={userId || '(session has no user id)'}
          mono={Boolean(userId)}
          disabled={!userId}
        />
      </div>
    </div>
  );
}

function IdentityField({ label, value, mono = false, disabled = false }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (disabled || !value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable: silent fail
    }
  }, [value, disabled]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-tertiary">{label}</span>
        <button
          type="button"
          onClick={handleCopy}
          disabled={disabled}
          className="rounded p-1 text-tertiary transition-colors hover:text-secondary disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Copy ${label}`}
          title={copied ? 'Copied' : 'Copy'}
        >
          {copied ? (
            <CheckCircle2 size={12} className="text-success" />
          ) : (
            <Copy size={12} />
          )}
        </button>
      </div>
      <div
        className={[
          'break-all rounded border border-border bg-surface-tertiary p-2 text-xs',
          mono ? 'font-mono' : '',
          disabled ? 'text-tertiary' : 'text-secondary',
        ].join(' ')}
      >
        {value}
      </div>
    </div>
  );
}
