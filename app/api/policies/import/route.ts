export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getSql } from '../../../lib/db.js';
import { getOrgId, getOrgRole } from '../../../lib/org.js';
import { findPolicyByName, insertPolicy } from '../../../lib/repositories/guardrails.repository.js';
import { inferPolicyType, AVAILABLE_PACKS } from '../../../lib/policyPackPreviews.js';

const VALID_PACKS = AVAILABLE_PACKS;

/**
 * POST /api/policies/import — Import a policy pack or raw YAML
 * Body: { pack: string } OR { yaml: string }
 */
export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const role = getOrgRole(request);

    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { pack, yaml: rawYaml } = body;

    if (!pack && !rawYaml) {
      return NextResponse.json({ error: 'Either pack or yaml is required' }, { status: 400 });
    }

    let policies;

    if (pack) {
      if (!VALID_PACKS.includes(pack)) {
        return NextResponse.json({ error: `Invalid pack. Choose from: ${VALID_PACKS.join(', ')}` }, { status: 400 });
      }

      // Load the pack's policies.yml
      const packPath = join(process.cwd(), 'app', 'lib', 'guardrails', 'packs', pack, 'policies.yml');
      let yamlContent;
      try {
        yamlContent = await readFile(packPath, 'utf-8');
      } catch {
        return NextResponse.json({ error: `Pack file not found: ${pack}` }, { status: 404 });
      }

      // Dynamically import js-yaml
      const jsYaml = await import('js-yaml');
      const doc = jsYaml.load(yamlContent) as { policies?: unknown[] };
      policies = doc.policies || [];
    } else {
      // Parse raw YAML
      const jsYaml = await import('js-yaml');
      const doc = jsYaml.load(rawYaml) as { policies?: unknown[] };
      policies = doc.policies || [];
    }

    const url = new URL(request.url);
    const preview = url.searchParams.get('preview') === 'true';

    if (preview) {
      const previewPolicies = [];
      for (const policy of policies as Array<Record<string, unknown>>) {
        const name = (policy.description || policy.id) as string;
        const policyType = inferPolicyType(policy);
        const existing = await findPolicyByName(sql, orgId, name);
        previewPolicies.push({
          name,
          policy_type: policyType,
          rules: policy.rules ? JSON.stringify(policy.rules) : JSON.stringify(policy.rule || {}),
          conflict: existing.length > 0,
          conflict_reason: existing.length > 0 ? 'Policy with this name already exists' : undefined,
        });
      }
      return NextResponse.json({
        preview: true,
        would_create: previewPolicies.filter(p => !p.conflict).length,
        would_skip: previewPolicies.filter(p => p.conflict).length,
        policies: previewPolicies,
      });
    }

    const imported = [];
    const skipped = [];
    const errors = [];

    for (const policy of policies as Array<Record<string, unknown>>) {
      try {
        const policyType = inferPolicyType(policy);
        const name = (policy.description || policy.id) as string;
        const rules = policy.rules
          ? JSON.stringify(policy.rules)
          : JSON.stringify({
              action_types: (policy.applies_to as { tools?: unknown[] })?.tools || [],
              ...((policy.rule as Record<string, unknown>) || {}),
              tests: policy.tests || [],
            });

        // Check for existing policy with same name
        const existing = await findPolicyByName(sql, orgId, name);

        if (existing.length > 0) {
          skipped.push(name);
          continue;
        }

        const id = `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

        const result = await insertPolicy(sql, orgId, { id, name, policyType, rules }) as Record<string, unknown>;

        imported.push({
          id: result.id,
          name: result.name,
          policy_type: result.policy_type,
          active: result.active,
        });
      } catch (err) {
        errors.push(`Failed to import "${policy.id || 'unknown'}": ${(err as Error).message}`);
      }
    }

    return NextResponse.json({
      imported: imported.length,
      skipped: skipped.length,
      errors,
      policies: imported,
    }, { status: 201 });
  } catch (err) {
    console.error('[POLICIES/IMPORT] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
