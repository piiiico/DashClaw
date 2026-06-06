import crypto from 'crypto';
import type { SqlTag } from '../types/db';

interface AccessRuleRow {
  rule_id: unknown;
  org_id: unknown;
  capability_id: unknown;
  agent_id?: unknown;
  access: unknown;
  reason?: unknown;
  created_by?: unknown;
  created_at: unknown;
  [k: string]: unknown;
}

interface AccessRuleInput {
  capability_id?: unknown;
  agent_id?: unknown;
  access: string;
  reason?: unknown;
  created_by?: unknown;
  [k: string]: unknown;
}

export function shapeAccessRule(row: AccessRuleRow | null | undefined): Record<string, unknown> | null {
  if (!row) return null;
  return {
    rule_id: row.rule_id,
    org_id: row.org_id,
    capability_id: row.capability_id,
    agent_id: row.agent_id || null,
    access: row.access,
    reason: row.reason || null,
    created_by: row.created_by || null,
    created_at: row.created_at,
  };
}

const VALID_ACCESS_LEVELS = new Set(['allow', 'deny', 'require_approval']);

export async function evaluateAccess(
  sql: SqlTag,
  orgId: string,
  capabilityId: string,
  agentId: string | null,
): Promise<{ access: unknown; rule: Record<string, unknown> | null }> {
  // Single query: agent-specific rules first, then org-wide defaults
  const rows = await sql`
    SELECT rule_id, org_id, capability_id, agent_id, access, reason, created_by, created_at
    FROM capability_access_rules
    WHERE org_id = ${orgId}
      AND capability_id = ${capabilityId}
      AND (agent_id = ${agentId} OR agent_id IS NULL)
    ORDER BY agent_id IS NULL ASC
    LIMIT 1
  `;

  if (rows.length === 0) {
    return { access: 'allow', rule: null };
  }

  const row = rows[0] as AccessRuleRow | undefined;
  return { access: row?.access, rule: shapeAccessRule(row) };
}

export async function listAccessRules(
  sql: SqlTag,
  orgId: string,
  capabilityId: string,
): Promise<{ rules: Array<Record<string, unknown> | null> }> {
  const rows = await sql`
    SELECT * FROM capability_access_rules
    WHERE org_id = ${orgId} AND capability_id = ${capabilityId}
    ORDER BY agent_id IS NULL ASC, created_at DESC
  `;
  return { rules: rows.map((r) => shapeAccessRule(r as AccessRuleRow)) };
}

export async function createAccessRule(
  sql: SqlTag,
  orgId: string,
  data: AccessRuleInput,
): Promise<Record<string, unknown> | null> {
  if (!VALID_ACCESS_LEVELS.has(data.access)) {
    throw new Error(`Invalid access level: ${data.access}. Must be allow, deny, or require_approval.`);
  }

  // Duplicate prevention is enforced by the two partial unique indexes
  // (capability_access_rules_unique_agent / ..._unique_default). Catch
  // unique_violation (23505) from the INSERT to distinguish a duplicate
  // from any other DB error, eliminating the prior check-then-insert race.
  const ruleId = `car_${crypto.randomUUID()}`;
  try {
    const rows = await sql`
      INSERT INTO capability_access_rules (
        rule_id, org_id, capability_id, agent_id, access, reason, created_by
      ) VALUES (
        ${ruleId}, ${orgId}, ${data.capability_id},
        ${data.agent_id || null}, ${data.access}, ${data.reason || null}, ${data.created_by || null}
      )
      RETURNING *
    `;
    return shapeAccessRule(rows[0] as AccessRuleRow | undefined);
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') {
      throw new Error('A rule for this capability and agent already exists. Delete it first.');
    }
    throw err;
  }
}

export async function deleteAccessRule(
  sql: SqlTag,
  orgId: string,
  ruleId: string,
): Promise<{ deleted: boolean } | null> {
  const rows = await sql`
    DELETE FROM capability_access_rules
    WHERE org_id = ${orgId} AND rule_id = ${ruleId}
    RETURNING rule_id
  `;
  return rows.length > 0 ? { deleted: true } : null;
}
