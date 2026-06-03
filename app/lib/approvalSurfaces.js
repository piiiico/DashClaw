import { after } from 'next/server';
import { fireTelegramApproval } from './telegramApprovals.js';
import { fireDiscordApproval } from './discordApprovals.js';
import { fireWebhooksForApproval } from './webhooks.js';

/**
 * Fire the operator approval surfaces (Telegram, Discord, outbound webhook) for a
 * newly-created `pending_approval` action. Mirrors the inline firing in
 * POST /api/actions so every path that creates a pending_approval record notifies
 * operators the same way.
 *
 * Fire-and-forget via `after()` so the HTTP response is never blocked (Vercel
 * freezes the lambda once the response returns unless `after()` is used); each
 * surface no-ops when its channel is unconfigured.
 *
 * @param {object} createdAction  the action record returned by createActionRecord
 * @param {Function} sql          the Neon sql tag
 * @param {string} orgId
 * @param {object|null} guardDecision  the guard decision (for matched_policies/reason)
 */
export function fireApprovalSurfaces(createdAction, sql, orgId, guardDecision = null) {
  if (!createdAction || createdAction.status !== 'pending_approval') return;
  after(() => fireTelegramApproval(createdAction, sql, orgId));
  after(() => fireDiscordApproval(createdAction, sql, orgId));
  after(() => fireWebhooksForApproval(orgId, 'approval_pending', {
    ...createdAction,
    matched_policies: guardDecision?.matched_policies,
    reason: guardDecision?.reason,
  }, sql).catch(() => {}));
}
