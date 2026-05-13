export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { timingSafeCompare } from '../../../lib/timing-safe.js';
import { EVENTS, publishOrgEvent } from '../../../lib/events.js';
import { fireWebhooksForOrg } from '../../../lib/webhooks.js';
import {
  listOrgsWithStaleOutcomes,
  sweepLostOutcomesForOrg,
} from '../../../lib/repositories/actions.repository.js';
import { getSettings } from '../../../lib/repositories/settings.repository.js';

const DEFAULT_TIMEOUT_MINUTES = 15;
const FLOOR_TIMEOUT_MINUTES = 1;
const CEILING_TIMEOUT_MINUTES = 24 * 60;

async function resolveTimeoutMinutes(sql, orgId) {
  try {
    const rows = await getSettings(sql, orgId, { key: 'DASHCLAW_OUTCOME_TIMEOUT_MINUTES' });
    const raw = rows?.[0]?.value;
    if (raw == null || raw === '') return DEFAULT_TIMEOUT_MINUTES;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MINUTES;
    return Math.min(CEILING_TIMEOUT_MINUTES, Math.max(FLOOR_TIMEOUT_MINUTES, Math.floor(n)));
  } catch {
    return DEFAULT_TIMEOUT_MINUTES;
  }
}

function buildSignal(row) {
  return {
    type: 'lost_confirmation',
    severity: 'warning',
    agent_id: row.agent_id || null,
    action_id: row.action_id,
    declared_goal: row.declared_goal || null,
    action_type: row.action_type || null,
    created_at: row.created_at,
    outcome_at: row.outcome_at,
    message: 'Action passed its outcome timeout without an agent report',
  };
}

export async function GET(request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
    }
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !timingSafeCompare(authHeader, `Bearer ${cronSecret}`)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sql = getSql();
    const summary = { orgs_scanned: 0, rows_swept: 0, webhooks_fired: 0 };

    const orgIds = await listOrgsWithStaleOutcomes(sql, FLOOR_TIMEOUT_MINUTES);

    for (const orgId of orgIds) {
      const timeoutMinutes = await resolveTimeoutMinutes(sql, orgId);
      const swept = await sweepLostOutcomesForOrg(sql, orgId, timeoutMinutes);
      summary.orgs_scanned++;
      if (swept.length === 0) continue;

      summary.rows_swept += swept.length;
      const signals = swept.map(buildSignal);

      for (const signal of signals) {
        void publishOrgEvent(EVENTS.SIGNAL_DETECTED, { orgId, signal });
      }

      try {
        const whResults = await fireWebhooksForOrg(orgId, signals, sql);
        summary.webhooks_fired += whResults.filter((r) => r.success).length;
      } catch (err) {
        console.warn(`[outcome-sweep] webhook delivery failed for ${orgId}:`, err.message);
      }
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error('[cron/outcome-sweep] Error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
