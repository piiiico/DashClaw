export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { convertPolicies } from '../../../lib/guardrails/converter.js';
import { evaluateGuardrailPolicy } from '../../../lib/guardrails/evaluator.js';
import { getActivePolicies, createTestRun } from '../../../lib/repositories/guardrails.repository.js';

/**
 * POST /api/policies/test — Run guardrails tests against current org policies
 */
export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    const policies = await getActivePolicies(sql, orgId);

    if (policies.length === 0) {
      return NextResponse.json({
        results: { total_policies: 0, total_tests: 0, passed: 0, failed: 0, success: true, details: [] },
        generated_at: new Date().toISOString(),
      });
    }

    const policyDoc = convertPolicies(policies, `org-${orgId}`);

    const details = [];
    let totalTests = 0;
    let passed = 0;

    for (const policy of policyDoc.policies) {
      const testResults = [];
      for (const testCase of policy.tests || []) {
        totalTests++;
        const result = evaluateGuardrailPolicy(policy, testCase.input);
        const testPassed = result.allowed === testCase.expect.allowed;
        if (testPassed) passed++;
        testResults.push({
          name: testCase.name,
          passed: testPassed,
          expected: testCase.expect.allowed,
          actual: result.allowed,
          reason: result.reason || null,
        });
      }
      details.push({
        policy_id: policy.id,
        policy_name: policy.description,
        tests: testResults,
      });
    }

    const results = {
      total_policies: policyDoc.policies.length,
      total_tests: totalTests,
      passed,
      failed: totalTests - passed,
      success: passed === totalTests,
      details,
    };

    // Store test run result
    const runId = `gtr_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    await createTestRun(sql, orgId, { id: runId, ...results, triggered_by: 'manual' });

    return NextResponse.json({ results, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error('[POLICIES/TEST] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
