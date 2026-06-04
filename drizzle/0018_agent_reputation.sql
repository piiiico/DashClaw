-- 0018_agent_reputation.sql
-- Agent Reputation (SPEC-mega.md Group B): per-agent reputation events, the
-- current snapshot vector, and signed receipts. Org-scoped, idempotent,
-- Postgres-only. Every statement is safe to re-run, matching the auto-migrate
-- Step-1 contract (every .sql re-runs on every deploy).

CREATE TABLE IF NOT EXISTS "agent_reputation_events" (
  "id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "agent_id" TEXT NOT NULL,
  "source_agent_id" TEXT,
  "event_type" TEXT NOT NULL,
  "weight" REAL,
  "value" REAL,
  "action_id" TEXT,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "metadata" JSONB DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_reputation_events_org_agent" ON "agent_reputation_events" ("org_id", "agent_id", "occurred_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_reputation_snapshots" (
  "id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "agent_id" TEXT NOT NULL,
  "reliability_score" REAL,
  "completion_rate" REAL,
  "policy_violation_rate" REAL,
  "approval_adherence" REAL,
  "quality_score" REAL,
  "risk_score" INTEGER,
  "volume_weight" REAL,
  "confidence" REAL,
  "total_events" INTEGER NOT NULL DEFAULT 0,
  "last_event_at" TIMESTAMPTZ,
  "computed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "vector_hash" TEXT NOT NULL,
  CONSTRAINT "agent_reputation_snapshots_org_agent_unique" UNIQUE ("org_id", "agent_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_reputation_snapshots_org" ON "agent_reputation_snapshots" ("org_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_reputation_receipts" (
  "id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "agent_id" TEXT NOT NULL,
  "vector_hash" TEXT NOT NULL,
  "receipt" JSONB NOT NULL,
  "kid" TEXT NOT NULL,
  "issued_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_reputation_receipts_org_agent" ON "agent_reputation_receipts" ("org_id", "agent_id", "created_at");
