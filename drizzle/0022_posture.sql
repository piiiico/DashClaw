-- Governance posture score: per-finding resolution state + trend snapshots.
-- Additive only (CREATE TABLE / INDEX IF NOT EXISTS) — idempotent re-runs are a no-op.
CREATE TABLE IF NOT EXISTS "posture_findings_state" (
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "finding_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "note" TEXT,
  "actor" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("org_id", "finding_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "posture_snapshots" (
  "id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "score" NUMERIC NOT NULL,
  "dimensions" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_posture_snapshots_org_created" ON "posture_snapshots" ("org_id", "created_at");
