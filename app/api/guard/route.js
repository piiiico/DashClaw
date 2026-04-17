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
 * Decode a JWT payload without verifying the signature.
 * Phase 1: trust-on-assertion — the caller is already authenticated via API key.
 * We extract agent_id (sub) and agent_name purely for attribution in the audit trail.
 * Phase 2 will add JWKS verification on top.
 *
 * @param {string} authHeader - raw Authorization header value
 * @returns {{ agent_id?: string, agent_name?: string }} extracted claims (empty if not a valid JWT)
 */
function extractAgentClaimsFromJwt(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return {};
  try {
    const token = authHeader.slice(7);
    const parts = token.split('.');
    if (parts.length !== 3) return {};
    // Base64url decode the payload (no verification in Phase 1)
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8')
    );
    const result = {};
    if (typeof payload.sub === 'string' && payload.sub) result.agent_id = payload.sub;
    // AgentLair AATs use 'al_name'; generic JWTs may use 'agent_name' — support both
    const agentName = payload.al_name || payload.agent_name;
    if (typeof agentName === 'string' && agentName) result.agent_name = agentName;
    return result;
  } catch {
    // Malformed JWT — ignore silently, fall through to body-provided values
    return {};
  }
}

/**
 * POST /api/guard — Evaluate guard policies for a proposed action.
 * Returns allow/warn/block/require_approval.
 *
 * Body: { action_type, risk_score?, agent_id?, agent_name?, systems_touched?, reversible?, declared_goal? }
 * Query: ?include_signals=true (optional, adds live signal warnings)
 *
 * Agent identity resolution (Phase 1, trust-on-assertion):
 *   1. JWT claims from Authorization: Bearer <token> (agent_id ← sub, agent_name ← al_name || agent_name)
 *   2. Explicit body fields agent_id / agent_name (override JWT claims if provided)
 * No signature verification in Phase 1 — the existing API-key boundary provides authentication.
 */
export async function POST(request) {
  try {
    const orgId = getOrgId(request);
    const body = await request.json();

    // Extract agent identity from JWT if present (Phase 1: no verification)
    const jwtClaims = extractAgentClaimsFromJwt(request.headers.get('authorization'));

    // Body-provided values take precedence over JWT claims
    const enrichedBody = {
      ...jwtClaims,
      ...body,
    };

    const { valid, data, errors } = validateGuardInput(enrichedBody);

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
