import type { SqlTag } from '../types/db';

interface ScheduleData {
  agent_id: string;
  name: string;
  description?: string | null;
  cron_expression: string;
  enabled?: boolean;
  next_run?: string | null;
  [k: string]: unknown;
}

export async function listSchedules(
  sql: SqlTag,
  orgId: string,
  agentId?: string | null
): Promise<Record<string, unknown>[]> {
  if (agentId) {
    return sql`
      SELECT * FROM agent_schedules
      WHERE org_id = ${orgId} AND agent_id = ${agentId}
      ORDER BY created_at DESC
    `;
  }
  return sql`
    SELECT * FROM agent_schedules
    WHERE org_id = ${orgId}
    ORDER BY agent_id, created_at DESC
  `;
}

export async function createSchedule(
  sql: SqlTag,
  orgId: string,
  data: ScheduleData
): Promise<Record<string, unknown> | null> {
  const { agent_id, name, description, cron_expression, enabled, next_run } = data;
  const rows = await sql`
    INSERT INTO agent_schedules (org_id, agent_id, name, description, cron_expression, enabled, next_run)
    VALUES (
      ${orgId},
      ${agent_id},
      ${name},
      ${description || null},
      ${cron_expression},
      ${enabled !== false},
      ${next_run || null}
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}
