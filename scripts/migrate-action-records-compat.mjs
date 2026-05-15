#!/usr/bin/env node

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

async function hasColumn(tableName, columnName) {
  const rows = await sql`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
      AND column_name = ${columnName}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function getColumnMeta(tableName, columnName) {
  const rows = await sql`
    SELECT data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
      AND column_name = ${columnName}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function addColumns() {
  const columns = [
    'action_id TEXT',
    'agent_name TEXT',
    'swarm_id TEXT',
    'parent_action_id TEXT',
    'reasoning TEXT',
    'authorization_scope TEXT',
    'trigger TEXT',
    'systems_touched TEXT',
    'input_summary TEXT',
    'reversible INTEGER DEFAULT 1',
    'confidence INTEGER DEFAULT 50',
    'output_summary TEXT',
    'side_effects TEXT',
    'artifacts_created TEXT',
    'error_message TEXT',
    'duration_ms INTEGER',
    'cost_estimate REAL DEFAULT 0',
    'tokens_in INTEGER DEFAULT 0',
    'tokens_out INTEGER DEFAULT 0',
    'signature TEXT',
    'verified BOOLEAN DEFAULT FALSE',
  ];

  for (const col of columns) {
    await sql.query(`ALTER TABLE action_records ADD COLUMN IF NOT EXISTS ${col}`, []);
  }
}

async function addIndexes() {
  await sql.query('CREATE INDEX IF NOT EXISTS idx_action_records_action_id ON action_records(action_id)', []);
  await sql.query('CREATE INDEX IF NOT EXISTS idx_action_records_org_action_id ON action_records(org_id, action_id)', []);
}

function isIntegerType(dataType) {
  return dataType === 'integer' || dataType === 'bigint' || dataType === 'smallint';
}

async function ensureIdDefault() {
  const idMeta = await getColumnMeta('action_records', 'id');
  if (!idMeta) return;
  if (idMeta.column_default) return;

  if (isIntegerType(idMeta.data_type)) {
    await sql.query(
      'CREATE SEQUENCE IF NOT EXISTS action_records_id_compat_seq OWNED BY action_records.id',
      []
    );
    await sql.query(
      "ALTER TABLE action_records ALTER COLUMN id SET DEFAULT nextval('action_records_id_compat_seq')",
      []
    );
    return;
  }

  if (idMeta.data_type === 'text' || idMeta.data_type === 'character varying') {
    await sql.query(
      "ALTER TABLE action_records ALTER COLUMN id SET DEFAULT md5(random()::text || clock_timestamp()::text)",
      []
    );
  }
}

async function backfillActionId() {
  const idMeta = await getColumnMeta('action_records', 'id');
  const hasActionId = await hasColumn('action_records', 'action_id');
  if (!hasActionId) return;

  if (idMeta) {
    if (isIntegerType(idMeta.data_type)) {
      await sql.query(
        "UPDATE action_records SET action_id = CONCAT('act_', id::text) WHERE action_id IS NULL AND id IS NOT NULL",
        []
      );
    } else {
      await sql.query(
        'UPDATE action_records SET action_id = id::text WHERE action_id IS NULL AND id IS NOT NULL',
        []
      );
    }
  }
  await sql.query(
    "UPDATE action_records SET action_id = CONCAT('act_', md5(random()::text || clock_timestamp()::text)) WHERE action_id IS NULL",
    []
  );
}

async function main() {
  console.log('\n=== action_records compatibility migration ===\n');

  if (!(await tableExists('action_records'))) {
    console.error('action_records table does not exist. Run the primary project migration first.');
    process.exit(1);
  }

  await addColumns();
  await ensureIdDefault();
  await backfillActionId();
  await addIndexes();

  console.log('OK: action_records compatibility migration applied.');
}

main().catch((err) => {
  console.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
