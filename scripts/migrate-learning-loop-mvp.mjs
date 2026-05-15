#!/usr/bin/env node

// CLAUDE.md: every entry point must surface async rejections.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

import { createSqlFromEnv } from './_db.mjs';

async function migrate() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sql = createSqlFromEnv();
  console.log('Starting learning-loop MVP migration...');

  try {
    await sql`ALTER TABLE action_records ADD COLUMN IF NOT EXISTS recommendation_id TEXT`;
    await sql`ALTER TABLE action_records ADD COLUMN IF NOT EXISTS recommendation_applied INTEGER DEFAULT 0`;
    await sql`ALTER TABLE action_records ADD COLUMN IF NOT EXISTS recommendation_override_reason TEXT`;
    await sql`CREATE INDEX IF NOT EXISTS idx_action_records_recommendation_id ON action_records(org_id, recommendation_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS learning_episodes (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        action_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        status TEXT,
        outcome_label TEXT NOT NULL DEFAULT 'pending',
        risk_score INTEGER DEFAULT 0,
        reversible INTEGER DEFAULT 1,
        confidence INTEGER DEFAULT 50,
        duration_ms INTEGER,
        cost_estimate REAL DEFAULT 0,
        invalidated_assumptions INTEGER DEFAULT 0,
        open_loops INTEGER DEFAULT 0,
        recommendation_id TEXT,
        recommendation_applied INTEGER DEFAULT 0,
        score INTEGER NOT NULL,
        score_breakdown TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;
    await sql`ALTER TABLE learning_episodes ADD COLUMN IF NOT EXISTS recommendation_id TEXT`;
    await sql`ALTER TABLE learning_episodes ADD COLUMN IF NOT EXISTS recommendation_applied INTEGER DEFAULT 0`;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS learning_episodes_org_action_unique
      ON learning_episodes (org_id, action_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_learning_episodes_org_agent_action
      ON learning_episodes (org_id, agent_id, action_type)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_learning_episodes_recommendation_id
      ON learning_episodes (org_id, recommendation_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_learning_episodes_updated_at
      ON learning_episodes (updated_at)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS learning_recommendations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        agent_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        confidence INTEGER NOT NULL DEFAULT 50,
        sample_size INTEGER NOT NULL DEFAULT 0,
        top_sample_size INTEGER NOT NULL DEFAULT 0,
        success_rate REAL NOT NULL DEFAULT 0,
        avg_score REAL NOT NULL DEFAULT 0,
        hints TEXT NOT NULL,
        guidance TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        computed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;
    await sql`ALTER TABLE learning_recommendations ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1`;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS learning_recommendations_org_agent_action_unique
      ON learning_recommendations (org_id, agent_id, action_type)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_learning_recommendations_org_agent
      ON learning_recommendations (org_id, agent_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_learning_recommendations_active
      ON learning_recommendations (org_id, active)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS learning_recommendation_events (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        recommendation_id TEXT,
        agent_id TEXT,
        action_id TEXT,
        event_type TEXT NOT NULL,
        event_key TEXT,
        details TEXT,
        created_at TEXT NOT NULL
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_learning_recommendation_events_org_created
      ON learning_recommendation_events (org_id, created_at)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_learning_recommendation_events_org_rec
      ON learning_recommendation_events (org_id, recommendation_id, created_at)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_learning_recommendation_events_org_action
      ON learning_recommendation_events (org_id, action_id)
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS learning_recommendation_events_org_key_unique
      ON learning_recommendation_events (org_id, event_key)
    `;

    console.log('Learning-loop MVP migration complete.');
  } catch (error) {
    console.error(`Migration failed: ${error.message}`);
    process.exit(1);
  }
}

migrate();
