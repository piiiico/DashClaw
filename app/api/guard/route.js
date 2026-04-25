export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../lib/org';
import { validateGuardInput } from '../../lib/validate';
import { evaluateGuard } from '../../lib/guard';
import { getSql } from '../../lib/db.js';
import { apiErrorResponse } from '../../lib/apiErrors.js';
import { scanForPromptInjection } from '../../lib/promptInjection.js';
import { listGuardDecisions } from '../../lib/repositories/guard.repository.js';
import { isSelfHostModeEnabled } from '../../lib/selfHost.js';

/**
 * POST /api/guard — Evaluate guard policies for a proposed action.
 * Returns allow/warn/block/require_approval.
 *
 * Body: { action_type, risk_score?, agent_id?, agent_name?, systems_touched?, reversible?, declared_goal? }
 * Query: ?include_signals=true (optional, adds live signal warnings)
 *
 * Agent identity (Phase 1, trust-on-assertion):
 *   Pass agent_id and agent_name directly in the request body. The existing
 *   API-key boundary provides authentication. Phase 2 will add JWKS verification
 *   and a verification_status field.
 */
export async function POST(request) {
  try {
    const orgId = getOrgId(request);
    const body = await request.json();

    const { valid, data, errors } = validateGuardInput(body);

    if (!valid) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    // SECURITY: Block prompt injection patterns in declared_goal (per D-04)
    const goalText = data.declared_goal || '';
    if (goalText) {
      const injectionScan = scanForPromptInjection(goalText);
      if (injectionScan.recommendation === 'block') {
        return NextResponse.json({
          error: 'Input rejected: prompt injection pattern detected',
          risk_level: injectionScan.risk_level,
          categories: injectionScan.categories,
        }, { status: 400 });
      }
    }

    const sql = getSql();
    const includeSignals = request.nextUrl.searchParams.get('include_signals') === 'true';

    let computeSignalsFn = null;
    if (includeSignals) {
      const { computeSignals } = await import('../../lib/signals');
      computeSignalsFn = computeSignals;
    }

    const result = await evaluateGuard(orgId, data, sql, {
      includeSignals,
      computeSignals: computeSignalsFn,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return apiErrorResponse(err, 'GUARD POST');
  }
}

/**
 * GET /api/guard — List recent guard decisions.
 *
 * Query: ?agent_id=X&decision=block&limit=20&offset=0
 */
export async function GET(request) {
  try {
    const orgId = getOrgId(request);

    // Self-host bypass: if no org is configured yet, return empty results gracefully.
    if (isSelfHostModeEnabled() && orgId === 'org_default') {
      const sql = getSql();
      const { searchParams } = request.nextUrl;
      const agentId = searchParams.get('agent_id') || undefined;
      const decision = searchParams.get('decision') || undefined;
      const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 1000);
      const offset = parseInt(searchParams.get('offset') || '0', 10);

      const result = await listGuardDecisions(sql, orgId, { agentId, decision, limit, offset });
      return NextResponse.json({ ...result, limit, offset });
    }

    const sql = getSql();
    const { searchParams } = request.nextUrl;
    const agentId = searchParams.get('agent_id') || undefined;
    const decision = searchParams.get('decision') || undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 1000);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const result = await listGuardDecisions(sql, orgId, { agentId, decision, limit, offset });
    return NextResponse.json({ ...result, limit, offset });
  } catch (err) {
    return apiErrorResponse(err, 'GUARD GET');
  }
}
