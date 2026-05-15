#!/usr/bin/env node

/**
 * Cost Analytics Migration Script
 * Adds cost_estimate to goals and ensures token tables are correctly indexed.
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
  console.log('\n=== Cost Analytics Migration ===\n');

  try {
    // 1. Add cost_estimate to goals
    console.log('Step 1: Adding cost_estimate to goals table...');
    await sql`ALTER TABLE goals ADD COLUMN IF NOT EXISTS cost_estimate REAL DEFAULT 0`;
    console.log('✅ goals.cost_estimate ready');

    // 2. Add cost_estimate to milestones
    console.log('Step 2: Adding cost_estimate to milestones table...');
    await sql`ALTER TABLE milestones ADD COLUMN IF NOT EXISTS cost_estimate REAL DEFAULT 0`;
    console.log('✅ milestones.cost_estimate ready');

    // 3. Ensure action_records has tokens_in/out for auto-calculation
    console.log('Step 3: Adding token columns to action_records for auto-cost calculation...');
    await sql`ALTER TABLE action_records ADD COLUMN IF NOT EXISTS tokens_in INTEGER DEFAULT 0`;
    await sql`ALTER TABLE action_records ADD COLUMN IF NOT EXISTS tokens_out INTEGER DEFAULT 0`;
    console.log('✅ action_records token columns ready');

    console.log('\n=== Migration Complete ===\n');
  } catch (err) {
    console.error('\nMigration failed:', err.message);
    process.exit(1);
  }
}

run();
