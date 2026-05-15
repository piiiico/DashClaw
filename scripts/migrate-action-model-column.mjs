#!/usr/bin/env node

/**
 * Adds the `model` column to `action_records`.
 *
 * Populated by POST /api/actions and PATCH /api/actions/:id. Used by
 * estimateCost() at PATCH time to derive cost from tokens + model, and kept
 * around so that historical cost can be re-derived if pricing changes.
 *
 * Rows predating this migration start with `model = NULL`. estimateCost()
 * returns 0 for NULL/missing model by design — we refuse to guess, since a
 * guess would retroactively price every historical row as Opus. If you need
 * to price historical rows, add a backfill step that sets `model` based on
 * whatever signal you have (agent_id → default model, timestamp → the model
 * that was default at that time, etc.).
 *
 * Idempotent: safe to run multiple times.
 */

// CLAUDE.md: every entry point must surface async rejections.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

import './_load-env.mjs';
import { createSqlFromEnv } from './_db.mjs';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || DATABASE_URL.includes('<YOUR_NEON_DATABASE_URL>')) {
  console.error('DATABASE_URL is required and must be a valid connection string');
  process.exit(1);
}

const sql = createSqlFromEnv();

async function run() {
  console.log('\n=== action_records.model Migration ===\n');

  try {
    console.log('Adding action_records.model column (idempotent)...');
    await sql`ALTER TABLE action_records ADD COLUMN IF NOT EXISTS model TEXT`;
    console.log('✅ action_records.model ready');

    console.log('\n=== Migration Complete ===\n');
  } catch (err) {
    console.error('\nMigration failed:', err.message);
    process.exit(1);
  }
}

run();
