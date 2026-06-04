export const dynamic = 'force-dynamic';
export const revalidate = 0;

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { evaluateGuard } from '../../../lib/guard.js';
import { createActionRecord, createBlockedActionRecord } from '../../../lib/repositories/actions.repository.js';
import { createPurchase, listPurchases } from '../../../lib/repositories/x402.repository.js';

const REQUIRED = ['agent_id', 'provider', 'declared_goal', 'purchase_reason', 'context_gap', 'expected_value'];

/** GET /api/x402/purchases — list governed purchases (org-scoped). */
export async function GET(request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const providerId = new URL(request.url).searchParams.get('provider_id') || undefined;
    const purchases = await listPurchases(sql, orgId, { providerId });
    return NextResponse.json({ purchases });
  } catch (err) {
    console.error('[X402/PURCHASES] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/x402/purchases — govern + record a paid acquisition.
 * Runs guard, then blocks / holds-for-approval / creates a running purchase
 * action plus its x402_purchases detail row. The agent executes the actual x402
 * call itself (governance boundary); it later reports outcome via the existing
 * POST /api/actions/[actionId]/outcome and writes a result artifact.
 */
export async function POST(request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const body = await request.json().catch(() => ({}));

    const missing = REQUIRED.filter((k) => body[k] == null || body[k] === '');
    if (missing.length) {
      return NextResponse.json({ error: `Missing required fields: ${missing.join(', ')}` }, { status: 400 });
    }

    const action_id = `act_${crypto.randomUUID()}`;
    const timestamp_start = new Date().toISOString();
    const guardContext = {
      action_type: 'x402_purchase',
      agent_id: body.agent_id,
      provider: body.provider,
      declared_goal: body.declared_goal,
      cost_estimate: Number(body.cost_estimate ?? body.spend_amount ?? 0) || 0,
      risk_score: body.risk_score || 0,
    };

    const guardDecision = await evaluateGuard(orgId, guardContext, sql);

    if (guardDecision.decision === 'block') {
      const blocked = await createBlockedActionRecord(sql, {
        orgId, action_id,
        data: { ...body, action_type: 'x402_purchase' },
        guardDecision, signature: null, verified: false, timestamp_start,
      });
      return NextResponse.json({ action: blocked, decision: guardDecision }, { status: 403 });
    }

    const isPending = guardDecision.decision === 'require_approval';
    const actionStatus = isPending ? 'pending_approval' : 'running';

    const action = await createActionRecord(sql, {
      orgId, action_id,
      data: {
        agent_id: body.agent_id,
        agent_name: body.agent_name,
        action_type: 'x402_purchase',
        declared_goal: body.declared_goal,
        reasoning: body.purchase_reason,
        input_summary: body.context_gap,
        risk_score: body.risk_score || 0,
      },
      actionStatus,
      costEstimate: guardContext.cost_estimate,
      signature: null, verified: false, timestamp_start,
    });

    const purchase = await createPurchase(sql, orgId, action_id, {
      provider_id: body.provider_id,
      endpoint_id: body.endpoint_id,
      agent_id: body.agent_id,
      spend_amount: guardContext.cost_estimate,
      currency: body.currency,
      payment_method: body.payment_method,
      wallet_reference: body.wallet_reference,
      purchase_reason: body.purchase_reason,
      context_gap: body.context_gap,
      alternatives_considered: body.alternatives_considered,
      expected_value: body.expected_value,
      confidence_score: body.confidence_score,
      execution_status: isPending ? 'pending' : 'approved',
    });

    return NextResponse.json({ action, purchase, decision: guardDecision }, { status: isPending ? 202 : 201 });
  } catch (err) {
    console.error('[X402/PURCHASES] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
