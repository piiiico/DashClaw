export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db.js';
import { getOrgId } from '../../lib/org.js';
import { apiErrorResponse } from '../../lib/apiErrors.js';
import { computePosturePayload } from '../../lib/posture/signals.js';

/**
 * GET /api/posture
 *
 * Returns the org's current governance posture score, per-dimension breakdown,
 * prioritized remediation findings, and a summary counts object.
 *
 * snapshotTs is null until Task 8 adds posture_snapshots persistence.
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    const { score, findings, unitCount } = await computePosturePayload(sql, orgId);

    const coveredUnits = findings.filter((f) => f.scoreDelta === 0).length;
    const openFindings = findings.filter((f) => f.status === 'open').length;
    const pointsRecoverable = findings.reduce((s, f) => s + f.scoreDelta, 0);

    return NextResponse.json({
      score: score.score,
      status: score.status,
      dimensions: score.dimensions,
      findings,
      summary: {
        totalUnits: unitCount,
        coveredUnits: unitCount - openFindings,
        pointsRecoverable,
        openFindings,
      },
      snapshotTs: null,
    });
  } catch (error) {
    return apiErrorResponse(error, 'POSTURE GET');
  }
}
