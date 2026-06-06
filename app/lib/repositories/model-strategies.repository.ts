import crypto from 'crypto';
import type { SqlTag } from '../types/db';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const COST_SENSITIVITY = new Set(['low', 'balanced', 'high-quality']);
const LATENCY_SENSITIVITY = new Set(['low', 'medium', 'high']);

interface StrategyConfig {
  primary?: { provider?: unknown; model?: unknown } & Record<string, unknown>;
  costSensitivity?: string;
  latencySensitivity?: string;
  maxBudgetUsd?: unknown;
  maxRetries?: unknown;
  fallback?: unknown;
  allowedProviders?: unknown;
  disallowedProviders?: unknown;
  [k: string]: unknown;
}

interface StrategyRow {
  strategy_id: unknown;
  org_id: unknown;
  name: unknown;
  description?: unknown;
  config_json?: unknown;
  created_by?: unknown;
  created_at: unknown;
  updated_at: unknown;
  [k: string]: unknown;
}

interface StrategyInput {
  name?: unknown;
  strategy_id?: string;
  description?: string | null;
  config: unknown;
  created_by?: string | null;
  [k: string]: unknown;
}

interface StrategyPatch {
  name?: unknown;
  description?: unknown;
  config?: Record<string, unknown>;
  [k: string]: unknown;
}

function safeJsonParse(value: unknown, fallback: unknown): unknown {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Validate a strategy config payload. Throws with a descriptive error on the
 * first violation. Intentionally lightweight — we only enforce fields that
 * cause downstream surprises, not a full JSON schema.
 */
export function validateStrategyConfig(config: unknown): boolean {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('config must be an object');
  }
  const c = config as StrategyConfig;
  if (!c.primary || typeof c.primary !== 'object') {
    throw new Error('config.primary is required');
  }
  if (!c.primary.provider || !c.primary.model) {
    throw new Error('config.primary.provider and config.primary.model are required');
  }
  if (c.costSensitivity && !COST_SENSITIVITY.has(c.costSensitivity)) {
    throw new Error(
      `config.costSensitivity must be one of ${Array.from(COST_SENSITIVITY).join(', ')}`
    );
  }
  if (c.latencySensitivity && !LATENCY_SENSITIVITY.has(c.latencySensitivity)) {
    throw new Error(
      `config.latencySensitivity must be one of ${Array.from(LATENCY_SENSITIVITY).join(', ')}`
    );
  }
  if (c.maxBudgetUsd != null && typeof c.maxBudgetUsd !== 'number') {
    throw new Error('config.maxBudgetUsd must be a number when provided');
  }
  if (c.maxRetries != null && !Number.isInteger(c.maxRetries)) {
    throw new Error('config.maxRetries must be an integer when provided');
  }
  if (c.fallback != null && !Array.isArray(c.fallback)) {
    throw new Error('config.fallback must be an array when provided');
  }
  if (c.allowedProviders != null && !Array.isArray(c.allowedProviders)) {
    throw new Error('config.allowedProviders must be an array when provided');
  }
  if (c.disallowedProviders != null && !Array.isArray(c.disallowedProviders)) {
    throw new Error('config.disallowedProviders must be an array when provided');
  }
  return true;
}

export function shapeStrategy(row: StrategyRow | null | undefined): Record<string, unknown> | null {
  if (!row) return null;
  return {
    strategy_id: row.strategy_id,
    org_id: row.org_id,
    name: row.name,
    description: row.description || null,
    config: safeJsonParse(row.config_json, {}),
    created_by: row.created_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function listModelStrategies(
  sql: SqlTag,
  orgId: string,
): Promise<Array<Record<string, unknown> | null>> {
  const rows = await sql`
    SELECT *
    FROM model_strategies
    WHERE org_id = ${orgId}
    ORDER BY updated_at DESC
  `;
  return rows.map((r) => shapeStrategy(r as StrategyRow));
}

export async function getModelStrategy(
  sql: SqlTag,
  orgId: string,
  strategyId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await sql`
    SELECT *
    FROM model_strategies
    WHERE org_id = ${orgId} AND strategy_id = ${strategyId}
    LIMIT 1
  `;
  return shapeStrategy(rows[0] as StrategyRow | undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

export async function createModelStrategy(
  sql: SqlTag,
  orgId: string,
  data: StrategyInput,
): Promise<Record<string, unknown> | null> {
  if (!data?.name || typeof data.name !== 'string') {
    throw new Error('name is required');
  }
  validateStrategyConfig(data.config);

  const strategy_id = data.strategy_id || `mst_${crypto.randomUUID()}`;

  const rows = await sql`
    INSERT INTO model_strategies (
      strategy_id,
      org_id,
      name,
      description,
      config_json,
      created_by
    ) VALUES (
      ${strategy_id},
      ${orgId},
      ${data.name},
      ${data.description || null},
      ${JSON.stringify(data.config)},
      ${data.created_by || null}
    )
    RETURNING *
  `;

  return shapeStrategy(rows[0] as StrategyRow | undefined);
}

export async function updateModelStrategy(
  sql: SqlTag,
  orgId: string,
  strategyId: string,
  patch: StrategyPatch = {},
): Promise<Record<string, unknown> | null> {
  const existing = await getModelStrategy(sql, orgId, strategyId);
  if (!existing) return null;

  const nextConfig = 'config' in patch
    ? { ...(existing.config as Record<string, unknown>), ...patch.config }
    : existing.config;
  if ('config' in patch) {
    validateStrategyConfig(nextConfig);
  }

  const rows = await sql`
    UPDATE model_strategies SET
      name = ${patch.name ?? existing.name},
      description = ${patch.description ?? existing.description},
      config_json = ${JSON.stringify(nextConfig)},
      updated_at = now()
    WHERE org_id = ${orgId} AND strategy_id = ${strategyId}
    RETURNING *
  `;
  return shapeStrategy(rows[0] as StrategyRow | undefined);
}

export async function deleteModelStrategy(
  sql: SqlTag,
  orgId: string,
  strategyId: string,
): Promise<boolean> {
  const existing = await getModelStrategy(sql, orgId, strategyId);
  if (!existing) return false;

  // Null out the soft reference on any workflow templates that linked to it
  // so we don't leave dangling FKs.
  await sql`
    UPDATE workflow_templates
    SET model_strategy_id = NULL, updated_at = now()
    WHERE org_id = ${orgId} AND model_strategy_id = ${strategyId}
  `;

  await sql`
    DELETE FROM model_strategies
    WHERE org_id = ${orgId} AND strategy_id = ${strategyId}
  `;
  return true;
}
