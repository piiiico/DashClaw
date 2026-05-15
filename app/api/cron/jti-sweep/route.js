export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { timingSafeCompare } from '../../../lib/timing-safe.js';
import { sweep } from '../../../lib/repositories/jti-replay.repository.js';

/**
 * GET /api/cron/jti-sweep — delete expired rows from jwt_replay_log.
 *
 * Phase 2b (issue #120, design by @piiiico). The repository runs a
 * probabilistic in-line sweep on ~1% of writes, but low-traffic periods
 * can leave expired rows around indefinitely. This endpoint is the
 * scheduled belt-and-suspenders, called every 5 minutes by
 * .github/workflows/jti-sweep.yml.
 *
 * Authentication: CRON_SECRET (same pattern as outcome-sweep).
 */
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
    const deleted = await sweep(sql);

    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    console.error('[cron/jti-sweep] Error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
