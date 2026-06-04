export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse, after } from 'next/server';
import { getSql } from '../../lib/db.js';
import { validateActionRecord } from '../../lib/validate.js';
import { getOrgId, getOrgRole } from '../../lib/org.js';
import { checkQuotaFast, getOrgPlan, incrementMeter } from '../../lib/usage.js';
import { apiErrorResponse } from '../../lib/apiErrors.js';
import { verifyAgentSignature } from '../../lib/identity.js';
import { estimateCost } from '../../lib/billing.js';
import { EVENTS, publishOrgEvent } from '../../lib/events.js';
import { generateActionEmbedding, isEmbeddingsEnabled } from '../../lib/embeddings.js';
import { evaluateGuard } from '../../lib/guard.js';
import { fireActionAlert } from '../../lib/actionAlerts.js';
import { fireTelegramApproval } from '../../lib/telegramApprovals.js';
import { fireDiscordApproval } from '../../lib/discordApprovals.js';
import { fireNewConnectAlert } from '../../lib/notification-adapters/discord.js';
import { fireWebhooksForApproval } from '../../lib/webhooks.js';
import { redactAny } from '../../lib/security.js';
import { upsertAgentPresence } from '../../lib/repositories/agents.repository.js';
import { incrementTrialActionCount } from '../../lib/repositories/hosted-workspace.repository.js';
import {
  createActionRecord,
  createBlockedActionRecord,
  deleteActionsByIds,
  getActionByIdempotencyKey,
  hasAgentAction,
  insertActionEmbedding,
  isFirstActionForOrg,
  listActions,
} from '../../lib/repositories/actions.repository.js';
import { getModelPricing, getSettings } from '../../lib/repositories/settings.repository.js';
import crypto from 'crypto';


export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const agent_id = searchParams.get('agent_id') || undefined;
    const swarm_id = searchParams.get('swarm_id') || undefined;
    const status = searchParams.get('status') || undefined;
    const exclude_status = searchParams.get('exclude_status') || undefined;
    const action_type = searchParams.get('action_type') || undefined;
    const risk_min = searchParams.get('risk_min') || undefined;
    const outcome_status = searchParams.get('outcome_status') || undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const result = await listActions(sql, orgId, {
      agent_id,
      swarm_id,
      status,
      exclude_status,
      action_type,
      risk_min,
      outcome_status,
      limit,
      offset,
    });

    return NextResponse.json({
      actions: result.actions,
      total: result.total,
      stats: result.stats,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    return apiErrorResponse(error, 'ACTIONS GET');
  }
}

export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const { valid, data, errors } = validateActionRecord(body);
    if (!valid) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    // Idempotency short-circuit. If the caller supplied an idempotency_key and
    // we already have a row for (org_id, idempotency_key), return that row
    // instead of doing duplicate work. Safe because the unique index on
    // action_records (org_id, idempotency_key) prevents a race-condition
    // double-insert even if two requests hit this code path simultaneously
    // — the second INSERT will fail and a retry resolves through this read.
    if (data.idempotency_key) {
      const existing = await getActionByIdempotencyKey(sql, orgId, data.idempotency_key);
      if (existing) {
        return NextResponse.json({
          action: existing,
          idempotent_replay: true,
        });
      }
    }

    // SECURITY: redact likely secrets before storing the action record.
    // Signature verification is performed against the original payload below, not the redacted copy.
    const dlpFindings = [];
    for (const k of [
      'agent_name',
      'declared_goal',
      'reasoning',
      'authorization_scope',
      'trigger',
      'input_summary',
      'output_summary',
      'error_message',
    ]) {
      if (data[k] != null) data[k] = redactAny(data[k], dlpFindings);
    }
    if (data.systems_touched != null) data.systems_touched = redactAny(data.systems_touched, dlpFindings);
    if (data.side_effects != null) data.side_effects = redactAny(data.side_effects, dlpFindings);
    if (data.artifacts_created != null) data.artifacts_created = redactAny(data.artifacts_created, dlpFindings);

    // Quota check: actions per month (fast meter path)
    const plan = await getOrgPlan(orgId, sql);
    const actionsQuota = await checkQuotaFast(orgId, 'actions_per_month', plan, sql);
    if (!actionsQuota.allowed) {
      return NextResponse.json(
        { error: 'Monthly action limit exceeded. Upgrade your plan.', code: 'QUOTA_EXCEEDED', usage: actionsQuota.usage, limit: actionsQuota.limit },
        { status: 402 }
      );
    }

    // Quota check: agents (only block new agent_ids)
    let isNewAgent = false;
    if (data.agent_id) {
      const existing = await hasAgentAction(sql, orgId, data.agent_id);
      isNewAgent = !existing;

      // SECURITY: Closed enrollment mode — reject unknown agent_ids
      if (isNewAgent && process.env.DASHCLAW_CLOSED_ENROLLMENT === 'true') {
        return NextResponse.json(
          { error: 'Agent not registered. Enable open enrollment or pre-register this agent.', code: 'AGENT_NOT_REGISTERED' },
          { status: 403 }
        );
      }

      if (!existing) {
        const agentsQuota = await checkQuotaFast(orgId, 'agents', plan, sql);
        if (!agentsQuota.allowed) {
          return NextResponse.json(
            { error: 'Agent limit reached. Upgrade your plan.', code: 'QUOTA_EXCEEDED', usage: agentsQuota.usage, limit: agentsQuota.limit },
            { status: 402 }
          );
        }
      }
    }

    // Generate action_id if not provided
    const action_id = data.action_id || `act_${crypto.randomUUID()}`;
    const timestamp_start = data.timestamp_start || new Date().toISOString();

    // Identity Verification
    const signature = body._signature || null;
    let verified = false;
    // Opt-in: set ENFORCE_AGENT_SIGNATURES=true to require signed agent actions.
    // Default OFF — signatures are an advanced feature, not a setup prerequisite.
    // Check DB setting first (runtime-toggleable), fall back to env var
    let enforceSignatures = process.env.ENFORCE_AGENT_SIGNATURES === 'true';
    try {
      const enforcementSettings = await getSettings(sql, orgId, { key: 'ENFORCE_AGENT_SIGNATURES' });
      if (enforcementSettings.length > 0) {
        enforceSignatures = enforcementSettings[0].value === 'true';
      }
    } catch { /* table may not exist yet — use env var fallback */ }

    if (enforceSignatures && !signature) {
      return NextResponse.json(
        { error: 'Signature required', code: 'SIGNATURE_REQUIRED' },
        { status: 401 }
      );
    }

    if (signature && data.agent_id) {
      // verify against the exact payload received (minus signature)
      const { _signature: s, ...payload } = body;
      verified = await verifyAgentSignature(orgId, data.agent_id, payload, signature, sql);
      
      if (!verified && enforceSignatures) {
        return NextResponse.json(
          { error: 'Invalid agent signature', code: 'INVALID_AGENT_SIGNATURE' },
          { status: 401 }
        );
      }
    }

    // BEHAVIOR GUARD EVALUATION
    const guardDecision = await evaluateGuard(orgId, {
      ...data,
      agent_id: data.agent_id
    }, sql);

    if (guardDecision.decision === 'block') {
      // Create a blocked action record for ledger visibility
      // This ensures blocked decisions appear in Decisions Ledger and contribute to agent discovery
      const blockedAction = await createBlockedActionRecord(sql, {
        orgId,
        action_id,
        data,
        guardDecision,
        signature,
        verified,
        timestamp_start,
      });

      // Emit real-time event so Mission Control feed shows the blocked decision
      void publishOrgEvent(EVENTS.ACTION_CREATED, {
        orgId,
        action: blockedAction,
      });

      fireActionAlert('blocked', blockedAction, sql, orgId);

      return NextResponse.json({
        error: 'Action blocked by policy', 
        action: blockedAction,
        decision: guardDecision 
      }, { status: 403 });
    }

    const isPendingApproval = guardDecision.decision === 'require_approval';
    const actionStatus = isPendingApproval ? 'pending_approval' : (data.status || 'running');

    // Auto-calculate cost if tokens are provided
    // SECURITY: Clamp agent-reported cost/token values to reasonable bounds
    const MAX_TOKENS = 10_000_000;
    const MAX_COST_USD = 10_000;
    if (data.tokens_in !== undefined) data.tokens_in = Math.max(0, Math.min(Number(data.tokens_in) || 0, MAX_TOKENS));
    if (data.tokens_out !== undefined) data.tokens_out = Math.max(0, Math.min(Number(data.tokens_out) || 0, MAX_TOKENS));
    if (data.cost_estimate !== undefined) data.cost_estimate = Math.max(0, Math.min(Number(data.cost_estimate) || 0, MAX_COST_USD));

    let costEstimate = data.cost_estimate || 0;
    if ((data.tokens_in || data.tokens_out) && !data.cost_estimate) {
      const customPricing = await getModelPricing(sql, orgId);
      costEstimate = estimateCost(data.tokens_in || 0, data.tokens_out || 0, data.model, customPricing);
    }

    const createdAction = await createActionRecord(sql, {
      orgId,
      action_id,
      data,
      actionStatus,
      costEstimate,
      signature,
      verified,
      timestamp_start,
    });

    // Fire-and-forget meter increments and presence update (don't block response)
    const meterUpdates = [incrementMeter(orgId, 'actions_per_month', sql)];
    if (isNewAgent) {
      meterUpdates.push(incrementMeter(orgId, 'agents', sql));
    }
    // Hosted-trial counter: no-ops silently for non-hosted orgs via WHERE hosted_mode = TRUE
    meterUpdates.push(
      incrementTrialActionCount(sql, orgId).catch((err) => {
        console.error('[HOSTED] trial counter increment failed:', err.message);
      }),
    );

    // Implicit heartbeat: submitting an action means the agent is online
    if (data.agent_id) {
      meterUpdates.push(
        upsertAgentPresence(sql, orgId, {
          agent_id: data.agent_id,
          agent_name: data.agent_name || null,
          status: 'online',
          current_task_id: action_id,
          metadata: null,
          timestamp: new Date().toISOString(),
        }).catch(() => {}) // best-effort, never block action creation
      );
    }
    
    // Background indexing for behavioral anomaly detection
    const indexAction = async () => {
      if (!isEmbeddingsEnabled()) return;
      try {
        const embedding = await generateActionEmbedding(data);
        if (embedding) {
          await insertActionEmbedding(sql, {
            orgId,
            agentId: data.agent_id,
            actionId: action_id,
            embedding,
          });
        }
      } catch (e) {
        console.warn('[API] Background indexing failed:', e.message);
      }
    };

    Promise.all([...meterUpdates, indexAction()]).catch((err) => {
      console.warn('[API] Background meter/index update failed:', err.message);
    });

    const response = NextResponse.json({ 
      action: createdAction, 
      action_id,
      decision: guardDecision,
      security: {
        clean: dlpFindings.length === 0,
        findings_count: dlpFindings.length,
        critical_count: dlpFindings.filter(f => f.severity === 'critical').length,
        categories: [...new Set(dlpFindings.map(f => f.category))],
      },
    }, { status: isPendingApproval ? 202 : 201 });
    
    // Emit real-time event
    void publishOrgEvent(EVENTS.ACTION_CREATED, {
      orgId,
      action: createdAction,
    });

    // Real-time Discord alerts for notable actions — use after() so work
    // continues after the response is sent (Vercel freezes the lambda once
    // the response returns unless after() is used).
    if (isPendingApproval) {
      after(() => fireActionAlert('pending_approval', createdAction, sql, orgId));
    } else {
      after(() => fireActionAlert('high_risk', createdAction, sql, orgId));
    }

    if (createdAction.status === 'pending_approval') {
      after(() => fireTelegramApproval(createdAction, sql, orgId));
      after(() => fireDiscordApproval(createdAction, sql, orgId));
      after(() => fireWebhooksForApproval(orgId, 'approval_pending', {
        ...createdAction,
        matched_policies: guardDecision?.matched_policies,
        reason: guardDecision?.reason,
      }, sql).catch(() => {}));
    }

    // Launch-window new-connect alert (DOG-04 telemetry).
    // Fires only if this is the org's first action_record AND the webhook
    // env var is configured. Fire-and-forget: never awaits, never blocks
    // the response. Repository helper keeps route-SQL guardrail clean.
    if (process.env.DASHCLAW_NEW_CONNECT_WEBHOOK) {
      after(() => {
        isFirstActionForOrg(sql, orgId, action_id)
          .then((isFirst) => {
            if (isFirst) {
              return fireNewConnectAlert({ orgId, agentId: data.agent_id });
            }
          })
          .catch((err) => {
            console.warn('[NewConnectAlert] probe failed:', err?.message || err);
          });
      });
    }

    if (actionsQuota.warning) {
      response.headers.set('x-quota-warning', `actions_per_month at ${actionsQuota.percent}%`);
    }
    return response;
  } catch (error) {
    if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
      return NextResponse.json({ error: 'Action with this action_id already exists' }, { status: 409 });
    }
    return apiErrorResponse(error, 'ACTIONS POST');
  }
}

/**
 * DELETE /api/actions — Delete actions by filter (admin only).
 *
 * Query params (at least one required):
 *   ?before=2026-02-01   — delete actions with timestamp_start before this date
 *   ?agent_id=X          — scope to a specific agent
 *   ?status=completed    — scope to a specific status
 *   ?action_id=act_xxx   — delete a single action by ID
 */
export async function DELETE(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const role = getOrgRole(request);

    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const before = searchParams.get('before');
    const agentId = searchParams.get('agent_id');
    const status = searchParams.get('status');
    const actionId = searchParams.get('action_id');

    const actionIds = searchParams.get('action_ids');

    // Bulk delete by specific IDs: ?action_ids=act_1,act_2,act_3
    if (actionIds) {
      const idList = actionIds.split(',').map(id => id.trim()).filter(Boolean);
      if (idList.length === 0) {
        return NextResponse.json({ error: 'No valid ids provided' }, { status: 400 });
      }
      const result = await deleteActionsByIds(sql, orgId, idList);
      return NextResponse.json({ deleted: result.length, action_ids: result.map(r => r.action_id) });
    }

    // Single action deletion
    if (actionId) {
      const result = await deleteActionsByIds(sql, orgId, [actionId]);
      return NextResponse.json({ deleted: result.length, action_ids: result.map(r => r.action_id) });
    }

    // Bulk deletion requires at least one filter to prevent accidental wipe
    if (!before && !agentId && !status) {
      return NextResponse.json({ error: 'At least one filter required: before, agent_id, or status' }, { status: 400 });
    }

    let paramIdx = 1;
    const conditions = [`org_id = $${paramIdx++}`];
    const params = [orgId];

    if (before) {
      conditions.push(`timestamp_start::timestamptz < $${paramIdx++}::timestamptz`);
      params.push(before);
    }
    if (agentId) {
      conditions.push(`agent_id = $${paramIdx++}`);
      params.push(agentId);
    }
    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(status);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    // Clean up related loops + assumptions first
    await sql.query(
      `DELETE FROM open_loops WHERE org_id = $1 AND action_id IN (SELECT action_id FROM action_records ${where})`,
      params
    );
    await sql.query(
      `DELETE FROM assumptions WHERE org_id = $1 AND action_id IN (SELECT action_id FROM action_records ${where})`,
      params
    );

    const result = await sql.query(
      `DELETE FROM action_records ${where} RETURNING action_id`,
      params
    );

    return NextResponse.json({ deleted: result.length });
  } catch (error) {
    return apiErrorResponse(error, 'ACTIONS DELETE');
  }
}
