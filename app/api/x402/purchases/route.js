export const dynamic = 'force-dynamic';
export const revalidate = 0;

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { evaluateGuard } from '../../../lib/guard.js';
import { apiErrorResponse } from '../../../lib/apiErrors.js';
import { validateX402Purchase } from '../../../lib/validate.js';
import { resolveAgentIdentity } from '../../../lib/identity-resolution.js';
import { redactAny } from '../../../lib/security.js';
import { createActionRecord, createBlockedActionRecord, deleteActionsByIds } from '../../../lib/repositories/actions.repository.js';
import { createPurchase, listPurchases, getProvider, getEndpoint, resolveProviderByName } from '../../../lib/repositories/x402.repository.js';

/**
 * Mask a wallet/payment reference for storage and responses. We keep only the
 * last 4 characters for reconciliation; the rest is never persisted or echoed.
 * (R9) These are sensitive identifiers — unlike /api/actions, the x402 path
 * previously stored and echoed them raw, and scanSensitiveData does not match
 * crypto wallet formats.
 */
function maskReference(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  return s.length <= 4 ? '****' : `****${s.slice(-4)}`;
}

/** GET /api/x402/purchases — list governed purchases (org-scoped). */
export async function GET(request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const providerId = new URL(request.url).searchParams.get('provider_id') || undefined;
    const purchases = await listPurchases(sql, orgId, { providerId });
    return NextResponse.json({ purchases });
  } catch (err) {
    return apiErrorResponse(err, 'X402/PURCHASES GET');
  }
}

/**
 * POST /api/x402/purchases — govern + record a paid acquisition.
 * Governance boundary: DashClaw evaluates, blocks, holds-for-approval, and
 * records the purchase; the AGENT executes the actual x402 call + payment and
 * later reports outcome via POST /api/actions/[actionId]/outcome. DashClaw never
 * holds wallet credentials or executes payment.
 */
export async function POST(request) {
  let orgId;
  let sql;
  let createdActionId = null;
  try {
    orgId = getOrgId(request);
    sql = getSql();
    const body = await request.json().catch(() => ({}));

    // (R4) Strict validation: rejects missing rationale, negative/NaN/Infinity
    // spend, malformed currency, and oversized free text BEFORE any work.
    const { valid, data: v, errors } = validateX402Purchase(body);
    if (!valid) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    // (R3) Shared identity contract: a JWKS-verified JWT overrides the body
    // agent_id; otherwise identity is explicitly self-asserted (unverified).
    const identity = await resolveAgentIdentity(request, { agentId: v.agent_id, agentName: body.agent_name });
    const agentId = identity.agent_id;

    // (R5) Provider / endpoint integrity. Validate ONLY when an id is supplied
    // (name-only purchases stay governed by policy for backward compatibility),
    // but a supplied id must exist in THIS org, be active/enabled, and the
    // endpoint must belong to the provider.
    let providerRow = null;
    if (v.provider_id) {
      providerRow = await getProvider(sql, orgId, v.provider_id);
      if (!providerRow) {
        return NextResponse.json({ error: 'Unknown provider_id for this organization' }, { status: 404 });
      }
      if (providerRow.status && providerRow.status !== 'active') {
        return NextResponse.json({ error: `Provider is not active (status: ${providerRow.status})` }, { status: 400 });
      }
    }
    if (v.endpoint_id) {
      const endpointRow = await getEndpoint(sql, orgId, v.endpoint_id);
      if (!endpointRow) {
        return NextResponse.json({ error: 'Unknown endpoint_id for this organization' }, { status: 404 });
      }
      const endpointEnabled = endpointRow.enabled === 1 || endpointRow.enabled === true;
      if (!endpointEnabled) {
        return NextResponse.json({ error: 'Endpoint is disabled' }, { status: 400 });
      }
      if (v.provider_id && endpointRow.provider_id !== v.provider_id) {
        return NextResponse.json({ error: 'endpoint_id does not belong to the given provider_id' }, { status: 400 });
      }
      // R5 gap fix: an endpoint_id supplied WITHOUT a provider_id must still
      // enforce that the endpoint's parent provider is active — otherwise a
      // disabled provider remains purchasable via its endpoint id.
      if (!providerRow && endpointRow.provider_id) {
        providerRow = await getProvider(sql, orgId, endpointRow.provider_id);
        if (providerRow && providerRow.status && providerRow.status !== 'active') {
          return NextResponse.json({ error: `Provider is not active (status: ${providerRow.status})` }, { status: 400 });
        }
      }
    }

    // (R6+) Resolve a provider_id for the purchase. Prefer an explicitly
    // supplied provider_id (validated above) or one derived from the endpoint;
    // otherwise resolve/auto-register from the free-text `provider` name so the
    // purchase carries real provider attribution instead of a null provider_id
    // (which renders blank on Spend → x402). This mirrors the plugin's
    // client-side resolveProviderId, but server-side so EVERY caller benefits —
    // SDK, the wrapper self-report path, MCP — without registering a provider
    // first. Done before guard so x402_spend_limit policies keyed by provider_id
    // match name-only callers too. Non-fatal: a governed purchase must never
    // fail over an attribution nicety.
    let resolvedProviderId = v.provider_id || providerRow?.provider_id || null;
    if (!resolvedProviderId && v.provider) {
      try {
        const resolved = await resolveProviderByName(sql, orgId, v.provider);
        if (resolved) {
          providerRow = resolved;
          resolvedProviderId = resolved.provider_id;
        }
      } catch (provErr) {
        console.warn('[X402/PURCHASES] provider auto-resolve failed:', provErr?.message || provErr);
      }
    }

    const action_id = `act_${crypto.randomUUID()}`;
    const timestamp_start = new Date().toISOString();

    // (R6) Pass BOTH the provider display name (resolved from the registry when
    // we have it) and the provider_id into the guard context so x402_spend_limit
    // allow/block lists match whether operators keyed them by name or id.
    const guardContext = {
      action_type: 'x402_purchase',
      agent_id: agentId,
      // Carry verified-identity status into the audit row so guard_decisions
      // is consistent with the action's persisted `verified` flag.
      verification_status: identity.verification_status,
      provider: providerRow?.name || v.provider,
      provider_id: resolvedProviderId,
      declared_goal: v.declared_goal,
      cost_estimate: v.spend_amount,
      risk_score: v.risk_score ?? 0,
    };

    const guardDecision = await evaluateGuard(orgId, guardContext, sql);

    // (R1) Authoritative risk: store the SAME score the guard decided on, so the
    // purchase action is consistent with guard_decisions. The client's input is
    // already folded into guardDecision.risk_score by the engine.
    const clientRisk = Math.max(0, Math.min(Math.round(Number(v.risk_score) || 0), 100));
    const authoritativeRisk = guardDecision?.risk_score != null
      ? Math.max(0, Math.min(Math.round(Number(guardDecision.risk_score) || 0), 100))
      : clientRisk;

    // (F2/R9) DLP-redact ALL stored free text before persistence, matching
    // /api/actions — including expected_value, alternatives_considered, and the
    // agent_name, which can carry secrets just like the other rationale fields.
    const dlp = [];
    const declared_goal = redactAny(v.declared_goal, dlp);
    const reasoning = redactAny(v.purchase_reason, dlp);
    const input_summary = redactAny(v.context_gap, dlp);
    const expectedValue = v.expected_value != null ? redactAny(v.expected_value, dlp) : null;
    const alternativesConsidered = v.alternatives_considered != null ? redactAny(v.alternatives_considered, dlp) : null;
    const agentName = identity.agent_name != null ? redactAny(identity.agent_name, dlp) : null;

    if (guardDecision.decision === 'block') {
      const blocked = await createBlockedActionRecord(sql, {
        orgId, action_id,
        data: {
          agent_id: agentId, agent_name: agentName, action_type: 'x402_purchase',
          declared_goal, reasoning, input_summary, risk_score: clientRisk,
        },
        guardDecision, signature: null, verified: identity.verified, timestamp_start,
        riskScore: authoritativeRisk,
      });
      return NextResponse.json({ action: blocked, decision: guardDecision }, { status: 403 });
    }

    const isPending = guardDecision.decision === 'require_approval';
    const actionStatus = isPending ? 'pending_approval' : 'running';

    const action = await createActionRecord(sql, {
      orgId, action_id,
      data: {
        agent_id: agentId,
        agent_name: agentName,
        action_type: 'x402_purchase',
        declared_goal,
        reasoning,
        input_summary,
        risk_score: clientRisk,
      },
      actionStatus,
      costEstimate: v.spend_amount,
      signature: null,
      verified: identity.verified,
      timestamp_start,
      riskScore: authoritativeRisk,
    });
    createdActionId = action_id;

    // (R7) Partial-write compensation: Neon HTTP has no multi-statement
    // transaction, so if the purchase-detail insert fails we delete the orphan
    // action rather than leaving an x402_purchase action_record with no detail.
    let purchase;
    try {
      purchase = await createPurchase(sql, orgId, action_id, {
        provider_id: resolvedProviderId,
        endpoint_id: v.endpoint_id,
        agent_id: agentId,
        spend_amount: v.spend_amount,
        currency: v.currency,
        payment_method: v.payment_method,
        wallet_reference: maskReference(v.wallet_reference),     // (R9)
        payment_reference: maskReference(v.payment_reference),   // (R9)
        purchase_reason: reasoning,
        context_gap: input_summary,
        alternatives_considered: alternativesConsidered,
        expected_value: expectedValue,
        confidence_score: v.confidence_score,
        execution_status: isPending ? 'pending' : 'approved',
      });
    } catch (purchaseErr) {
      await deleteActionsByIds(sql, orgId, [action_id]).catch(() => {});
      createdActionId = null; // already compensated; don't double-delete in outer catch
      throw purchaseErr;
    }
    // Purchase detail committed: action + purchase are now consistent, so the
    // outer-catch compensation must NOT delete this action (doing so would
    // orphan the purchase row and inflate x402 spend).
    createdActionId = null;

    return NextResponse.json({ action, purchase, decision: guardDecision }, { status: isPending ? 202 : 201 });
  } catch (err) {
    // Best-effort compensation if we threw after creating the action but the
    // catch wasn't the inner purchase handler (defense in depth).
    if (createdActionId && sql && orgId) {
      await deleteActionsByIds(sql, orgId, [createdActionId]).catch(() => {});
    }
    return apiErrorResponse(err, 'X402/PURCHASES POST');
  }
}
