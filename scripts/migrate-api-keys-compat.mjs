#!/usr/bin/env node

// Compat migration for api_keys. Ported from Elpolini's fork (elpolini/DashClaw commit dbf5463).

// CLAUDE.md: every entry point must surface async rejections.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

import { createSqlFromEnv } from './_db.mjs';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = createSqlFromEnv();

async function tableExists(name) {
  const rows = await sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${name}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function createTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      label TEXT DEFAULT 'default',
      role TEXT DEFAULT 'member',
      last_used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      revoked_at TIMESTAMP
    )
  `;
}

async function addColumns() {
  // Columns expected by app/api/keys/route.js and middleware.js key resolution.
  // Uses ADD COLUMN IF NOT EXISTS so this migration is idempotent on any schema version.
  const columns = [
    'org_id TEXT',
    'key_hash TEXT',
    'key_prefix TEXT',
    "label TEXT DEFAULT 'default'",
    "role TEXT DEFAULT 'member'",
    'last_used_at TIMESTAMP',
    'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    'revoked_at TIMESTAMP',
  ];

  for (const col of columns) {
    await sql.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS ${col}`, []);
  }
}

async function backfillNulls() {
  // Ensure label and role always have non-null values for legacy rows.
  await sql.query("UPDATE api_keys SET label = 'default' WHERE label IS NULL", []);
  await sql.query("UPDATE api_keys SET role = 'member' WHERE role IS NULL", []);
}

async function addIndexes() {
  await sql.query('CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)', []);
  await sql.query('CREATE INDEX IF NOT EXISTS idx_api_keys_org_id ON api_keys(org_id)', []);
}

async function main() {
  console.log('\n=== api_keys compatibility migration ===\n');

  await createTable();
  await addColumns();
  await backfillNulls();
  await addIndexes();

  console.log('OK: api_keys compatibility migration applied.');
}

main()
  .catch((err) => {
    console.error(`Migration failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await sql.end?.();
    } catch (_) {
      // ignore teardown errors
    }
  });
