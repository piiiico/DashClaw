/**
 * Core table verification for DashClaw.
 * Used by health endpoint, setup status, and first-request startup check.
 */

import {
  CORE_SETUP_TABLES,
  getSetupMigrationCommand,
} from './setup/runtime-prerequisites.mjs';

/** Tagged-template SQL client (callable tag returning rows). */
type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

/**
 * Tables that must exist for DashClaw to function.
 * Ordered roughly by migration step.
 */
export const CORE_TABLES: string[] = CORE_SETUP_TABLES;

export interface CoreTableCheck {
  ok: boolean;
  present: string[];
  missing: string[];
}

/**
 * Check which core tables exist in the database.
 */
export async function checkCoreTables(sql: SqlTag): Promise<CoreTableCheck> {
  const rows = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY(${CORE_TABLES})
  `;
  const found = new Set(rows.map((r) => r.table_name as string));
  const present = CORE_TABLES.filter((t) => found.has(t));
  const missing = CORE_TABLES.filter((t) => !found.has(t));
  return { ok: missing.length === 0, present, missing };
}

/**
 * Run schema check once on first DB access and log warnings.
 * Safe to call multiple times — only runs once.
 */
let _checked = false;
export async function startupSchemaCheck(sql: SqlTag): Promise<void> {
  if (_checked) return;
  _checked = true;

  try {
    const { ok, missing } = await checkCoreTables(sql);
    if (!ok) {
      console.warn(
        `[SCHEMA] Missing core tables: ${missing.join(', ')}. Run: ${getSetupMigrationCommand('scripts/migrate-multi-tenant.mjs')}`,
      );
    }
  } catch (err) {
    console.warn('[SCHEMA] Could not verify core tables:', (err as Error)?.message);
  }
}
