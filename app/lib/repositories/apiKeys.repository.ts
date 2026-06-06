// --- Read queries ---
import type { SqlTag } from '../types/db';

export async function findActiveKeyByHash(sql: SqlTag, keyHash: string): Promise<Record<string, unknown>[]> {
  return sql`
    SELECT id FROM api_keys
    WHERE key_hash = ${keyHash} AND revoked_at IS NULL
    LIMIT 1
  `;
}
