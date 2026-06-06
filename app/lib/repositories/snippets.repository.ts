import type { SqlTag } from '../types/db';

export async function getSnippetById(sql: SqlTag, orgId: string, snippetId: string): Promise<Record<string, unknown> | null> {
  const rows = await sql`
    SELECT * FROM snippets WHERE id = ${snippetId} AND org_id = ${orgId}
  `;
  return rows[0] || null;
}
