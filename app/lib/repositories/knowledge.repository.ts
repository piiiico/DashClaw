import crypto from 'crypto';
import type { SqlTag } from '../types/db';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_TYPES = new Set(['files', 'urls', 'external', 'notes']);

function safeJsonParse(value: unknown, fallback: unknown): unknown {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function shapeCollection(row: Record<string, unknown> | undefined | null): Record<string, unknown> | null {
  if (!row) return null;
  return {
    collection_id: row.collection_id,
    org_id: row.org_id,
    name: row.name,
    description: row.description || null,
    source_type: row.source_type,
    tags: safeJsonParse(row.tags_json, []),
    ingestion_status: row.ingestion_status,
    doc_count: row.doc_count,
    last_synced_at: row.last_synced_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function shapeItem(row: Record<string, unknown> | undefined | null): Record<string, unknown> | null {
  if (!row) return null;
  return {
    item_id: row.item_id,
    collection_id: row.collection_id,
    org_id: row.org_id,
    source_uri: row.source_uri,
    title: row.title || null,
    mime_type: row.mime_type || null,
    status: row.status,
    metadata: safeJsonParse(row.metadata_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

interface ListCollectionsFilters {
  sourceType?: string;
  limit?: number | string;
  offset?: number | string;
}

interface CollectionData {
  collection_id?: string;
  name?: string;
  description?: string | null;
  source_type?: string;
  tags?: unknown;
  [k: string]: unknown;
}

interface CollectionPatch {
  name?: string;
  description?: string | null;
  source_type?: string;
  tags?: unknown;
  ingestion_status?: string;
  [k: string]: unknown;
}

interface ListItemsFilters {
  limit?: number | string;
  offset?: number | string;
}

interface ItemData {
  item_id?: string;
  source_uri?: string;
  title?: string | null;
  mime_type?: string | null;
  status?: string;
  metadata?: unknown;
  [k: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collections
// ─────────────────────────────────────────────────────────────────────────────

export async function listCollections(sql: SqlTag, orgId: string, filters: ListCollectionsFilters = {}): Promise<Array<Record<string, unknown> | null>> {
  const { sourceType, limit = 50, offset = 0 } = filters;
  const parsedLimit = Math.min(parseInt(String(limit), 10) || 50, 200);
  const parsedOffset = parseInt(String(offset), 10) || 0;

  const rows = sourceType
    ? await sql`
        SELECT *
        FROM knowledge_collections
        WHERE org_id = ${orgId} AND source_type = ${sourceType}
        ORDER BY updated_at DESC
        LIMIT ${parsedLimit}
        OFFSET ${parsedOffset}
      `
    : await sql`
        SELECT *
        FROM knowledge_collections
        WHERE org_id = ${orgId}
        ORDER BY updated_at DESC
        LIMIT ${parsedLimit}
        OFFSET ${parsedOffset}
      `;

  return rows.map(shapeCollection);
}

export async function getCollection(sql: SqlTag, orgId: string, collectionId: string): Promise<Record<string, unknown> | null> {
  const rows = await sql`
    SELECT *
    FROM knowledge_collections
    WHERE org_id = ${orgId} AND collection_id = ${collectionId}
    LIMIT 1
  `;
  return shapeCollection(rows[0]);
}

export async function createCollection(sql: SqlTag, orgId: string, data: CollectionData): Promise<Record<string, unknown> | null> {
  if (!data?.name || typeof data.name !== 'string') {
    throw new Error('name is required');
  }
  const sourceType = data.source_type || 'files';
  if (!SOURCE_TYPES.has(sourceType)) {
    throw new Error(`source_type must be one of ${Array.from(SOURCE_TYPES).join(', ')}`);
  }

  const collection_id = data.collection_id || `kc_${crypto.randomUUID()}`;

  const rows = await sql`
    INSERT INTO knowledge_collections (
      collection_id,
      org_id,
      name,
      description,
      source_type,
      tags_json,
      ingestion_status,
      doc_count
    ) VALUES (
      ${collection_id},
      ${orgId},
      ${data.name},
      ${data.description || null},
      ${sourceType},
      ${JSON.stringify(data.tags || [])},
      ${'empty'},
      ${0}
    )
    RETURNING *
  `;

  return shapeCollection(rows[0]);
}

export async function deleteCollection(sql: SqlTag, orgId: string, collectionId: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM knowledge_collections
    WHERE org_id = ${orgId} AND collection_id = ${collectionId}
    RETURNING collection_id
  `;
  return rows.length > 0;
}

export async function updateCollection(sql: SqlTag, orgId: string, collectionId: string, patch: CollectionPatch = {}): Promise<Record<string, unknown> | null> {
  const existing = await getCollection(sql, orgId, collectionId);
  if (!existing) return null;

  if (patch.source_type && !SOURCE_TYPES.has(patch.source_type)) {
    throw new Error(`source_type must be one of ${Array.from(SOURCE_TYPES).join(', ')}`);
  }

  const rows = await sql`
    UPDATE knowledge_collections SET
      name = ${patch.name ?? existing.name},
      description = ${patch.description ?? existing.description},
      source_type = ${patch.source_type ?? existing.source_type},
      tags_json = ${JSON.stringify(patch.tags ?? existing.tags)},
      ingestion_status = ${patch.ingestion_status ?? existing.ingestion_status},
      updated_at = now()
    WHERE org_id = ${orgId} AND collection_id = ${collectionId}
    RETURNING *
  `;

  return shapeCollection(rows[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection items
// ─────────────────────────────────────────────────────────────────────────────

export async function listCollectionItems(sql: SqlTag, orgId: string, collectionId: string, filters: ListItemsFilters = {}): Promise<Array<Record<string, unknown> | null>> {
  const { limit = 100, offset = 0 } = filters;
  const parsedLimit = Math.min(parseInt(String(limit), 10) || 100, 500);
  const parsedOffset = parseInt(String(offset), 10) || 0;

  const rows = await sql`
    SELECT *
    FROM knowledge_collection_items
    WHERE org_id = ${orgId} AND collection_id = ${collectionId}
    ORDER BY created_at DESC
    LIMIT ${parsedLimit}
    OFFSET ${parsedOffset}
  `;
  return rows.map(shapeItem);
}

export async function addCollectionItem(sql: SqlTag, orgId: string, collectionId: string, data: ItemData): Promise<Record<string, unknown> | null> {
  if (!data?.source_uri || typeof data.source_uri !== 'string') {
    throw new Error('source_uri is required');
  }

  const existing = await getCollection(sql, orgId, collectionId);
  if (!existing) return null;

  const item_id = data.item_id || `kci_${crypto.randomUUID()}`;

  const rows = await sql`
    INSERT INTO knowledge_collection_items (
      item_id,
      collection_id,
      org_id,
      source_uri,
      title,
      mime_type,
      status,
      metadata_json
    ) VALUES (
      ${item_id},
      ${collectionId},
      ${orgId},
      ${data.source_uri},
      ${data.title || null},
      ${data.mime_type || null},
      ${data.status || 'pending'},
      ${JSON.stringify(data.metadata || {})}
    )
    RETURNING *
  `;

  // Bump the parent collection's doc count + ingestion status.
  await sql`
    UPDATE knowledge_collections
    SET doc_count = doc_count + 1,
        ingestion_status = CASE
          WHEN ingestion_status = 'empty' THEN 'pending'
          ELSE ingestion_status
        END,
        updated_at = now()
    WHERE org_id = ${orgId} AND collection_id = ${collectionId}
  `;

  return shapeItem(rows[0]);
}
