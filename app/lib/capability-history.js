import { isLegacyActionRecordsError } from './capability-compat.js';

function toInt(value, fallback = null) {
  if (value == null) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export async function getCapabilityHistory(sql, orgId, capability, filters = {}) {
  const {
    action_type,
    status,
    limit = 20,
    offset = 0,
  } = filters;

  const parsedLimit = Math.min(parseInt(limit, 10) || 20, 100);
  const parsedOffset = parseInt(offset, 10) || 0;
  const systemsTouched = JSON.stringify([`capability:${capability.slug}`]);

  let rows;

  try {
    rows = await sql`
      SELECT
        action_id,
        action_type,
        status,
        agent_id,
        declared_goal,
        trigger,
        output_summary,
        error_message,
        duration_ms,
        timestamp_start,
        timestamp_end
      FROM action_records
      WHERE org_id = ${orgId}
        AND systems_touched = ${systemsTouched}
        AND action_type IN ('capability_invoke', 'capability_test')
        ${action_type ? sql`AND action_type = ${action_type}` : sql``}
        ${status ? sql`AND status = ${status}` : sql``}
      ORDER BY timestamp_start::timestamptz DESC
      LIMIT ${parsedLimit}
      OFFSET ${parsedOffset}
    `;
  } catch (error) {
    if (!isLegacyActionRecordsError(error)) {
      throw error;
    }

    rows = await sql`
      SELECT
        action_id,
        action_type,
        status,
        agent_id,
        declared_goal,
        created_at as timestamp_start
      FROM action_records
      WHERE org_id = ${orgId}
        AND systems_touched = ${systemsTouched}
        AND action_type IN ('capability_invoke', 'capability_test')
        ${action_type ? sql`AND action_type = ${action_type}` : sql``}
        ${status ? sql`AND status = ${status}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${parsedLimit}
      OFFSET ${parsedOffset}
    `;
  }

  return {
    capability_id: capability.capability_id,
    name: capability.name,
    slug: capability.slug,
    events: rows.map((row) => ({
      action_id: row.action_id,
      action_type: row.action_type,
      status: row.status,
      agent_id: row.agent_id || null,
      declared_goal: row.declared_goal || null,
      trigger: row.trigger || null,
      output_summary: row.output_summary || null,
      error_message: row.error_message || null,
      duration_ms: toInt(row.duration_ms),
      timestamp_start: row.timestamp_start || null,
      timestamp_end: row.timestamp_end || null,
    })),
  };
}
