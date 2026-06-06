import type { SqlTag } from '../types/db';

function isMissingTable(err: unknown): boolean {
  return (
    String((err as { code?: unknown })?.code || '').includes('42P01') ||
    String((err as { message?: unknown })?.message || '').includes('does not exist')
  );
}

/**
 * Get shared actions between two agents — actions that occurred within 10 minutes of each other.
 */
export async function getSharedActions(
  sql: SqlTag,
  orgId: string,
  sourceIds: Iterable<unknown>,
  targetIds: Iterable<unknown>,
): Promise<Record<string, unknown>[]> {
  const combinedArr = [...new Set([...sourceIds, ...targetIds])];
  try {
    return await sql`
      SELECT a.id as action_id, a.agent_id, a.action_type, a.status, a.risk_score, a.timestamp_start
      FROM action_records a
      WHERE a.org_id = ${orgId}
        AND (a.agent_id = ANY(${combinedArr}) OR a.agent_name = ANY(${combinedArr}))
        AND EXISTS (
          SELECT 1 FROM action_records b
          WHERE b.org_id = a.org_id
            AND b.agent_id != a.agent_id
            AND (b.agent_id = ANY(${combinedArr}) OR b.agent_name = ANY(${combinedArr}))
            AND ABS(EXTRACT(EPOCH FROM (b.timestamp_start::timestamptz - a.timestamp_start::timestamptz))) < 600
        )
      ORDER BY a.timestamp_start DESC
      LIMIT 50
    `;
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/**
 * Get direct messages exchanged between two agents.
 */
export async function getAgentLinkMessages(
  sql: SqlTag,
  orgId: string,
  sourceIds: Iterable<unknown>,
  targetIds: Iterable<unknown>,
): Promise<Record<string, unknown>[]> {
  const sArr = Array.from(sourceIds);
  const tArr = Array.from(targetIds);
  try {
    return await sql`
      SELECT id as message_id, from_agent_id as sender_agent_id, to_agent_id as recipient_agent_id, body as content, created_at, thread_id
      FROM agent_messages
      WHERE org_id = ${orgId}
        AND (
          (from_agent_id = ANY(${sArr}) AND to_agent_id = ANY(${tArr}))
          OR
          (from_agent_id = ANY(${tArr}) AND to_agent_id = ANY(${sArr}))
        )
      ORDER BY created_at DESC
      LIMIT 30
    `;
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/**
 * Resolve agent IDs and names for a pair of agent identifiers.
 * Returns a map so the route can build sourceIds and targetIds sets.
 */
export async function resolveAgentIdentifiers(
  sql: SqlTag,
  orgId: string,
  source: unknown,
  target: unknown,
): Promise<Record<string, unknown>[]> {
  try {
    return await sql`
      SELECT agent_id, MAX(agent_name) as agent_name
      FROM action_records
      WHERE org_id = ${orgId}
        AND (agent_id IN (${source}, ${target}) OR agent_name IN (${source}, ${target}))
      GROUP BY agent_id
    `;
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}
