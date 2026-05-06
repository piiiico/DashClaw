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
import { verifyJwt, extractBearerToken } from '../../lib/jwks-verifier.js';

/**
 * POST /api/guard — Evaluate guard policies for a proposed action.
 * Returns allow/warn/block/require_approval.
 *
 * Body: { action_type, risk_score?, agent_id?, agent_name?, systems_touched?, reversible?, declared_goal? }
 * Query: ?include_signals=true (optional, adds live signal warnings)
 *
 * Agent identity — two tiers:
 *
 *   Phase 1 (trust-on-assertion): Pass agent_id / agent_name in the request
 *   body. The API-key boundary provides authentication. verification_status
 *   will be 'unverified'.
 *
 *   Phase 2 (JWKS verification): Attach `Authorization: Bearer <JWT>` to the
 *   request. DashClaw verifies the token against the issuer's JWKS endpoint
 *   (fetched from {iss}/.well-known/jwks.json, cached 1 h). On success:
 *     - verification_status → 'verified'
 *     - agent_id is set to the JWT `sub` claim (body value overridden for
 *       integrity: cryptographic proof beats self-assertion)
 *     - agent_name is set to the JWT `agent_name` claim (if present)
 *   On issuer outage the verifier fails-soft to 'unverified' so a downed
 *   identity provider cannot block agent decisions.
 *
 *   verification_status enum: verified | unverified | expired | failed | unknown_issuer
 *
 * Config (env vars, no YAML needed):
 *   DASHCLAW_ALLOWED_ISSUER  — restrict which JWT issuers are trusted
 *   DASHCLAW_JWT_AUDIENCE    — require this value in the `aud` claim
 *
 * Provider-agnostic: works with any OIDC issuer (Keycloak, Auth0, AgentLair,
 * etc.) — see docs/agent-identity.md for setup examples.
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

    // Phase 2: JWKS verification — resolve agent identity from JWT bearer token.
    // Fail-soft: infrastructure errors fall back to 'unverified', never 'failed'.
    const authHeader = request.headers.get('authorization');
    const bearerToken = extractBearerToken(authHeader);

    let verificationResult = null;
    if (bearerToken) {
      verificationResult = await verifyJwt(bearerToken);

      if (verificationResult.verification_status === 'verified') {
        // Cryptographic proof beats self-assertion.
        // Override any body-supplied agent_id with the JWT sub claim.
        if (verificationResult.agent_id) {
          if (data.agent_id && data.agent_id !== verificationResult.agent_id) {
            console.warn(
              `[Guard] JWT sub (${verificationResult.agent_id}) overrides body agent_id (${data.agent_id})`
            );
          }
          data.agent_id = verificationResult.agent_id;
        }
        // Use JWT agent_name if not supplied in the body
        if (verificationResult.agent_name && !data.agent_name) {
          data.agent_name = verificationResult.agent_name;
        }
      }

      data.verification_status = verificationResult.verification_status;
    } else {
      data.verification_status = 'unverified';
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
