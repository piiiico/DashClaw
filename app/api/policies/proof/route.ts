export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { convertPolicies } from '../../../lib/guardrails/converter.js';
import { generateMarkdownReport, generateJsonReport } from '../../../lib/guardrails/report.js';
import { getActivePolicies } from '../../../lib/repositories/guardrails.repository.js';

/**
 * GET /api/policies/proof?format=md|json — Generate proof report
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'md';

    const policies = await getActivePolicies(sql, orgId);
    const policyDoc = convertPolicies(policies, `org-${orgId}`);

    let report;
    if (format === 'json') {
      report = generateJsonReport(policyDoc);
    } else {
      report = generateMarkdownReport(policyDoc);
    }

    return NextResponse.json({
      report,
      format,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[POLICIES/PROOF] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
