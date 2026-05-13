-- Durable execution finality — five-state outcome machine on action_records.
-- See docs/architecture/durable-execution-finality.md for the design rationale.
--
-- Phase 1 ships the columns, indexes, repository helpers, and POST/GET
-- /api/actions/:id/outcome route. The cron sweep that fills in
-- lost_confirmation lands in Phase 2.

ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "outcome_status" TEXT NOT NULL DEFAULT 'pending';

--> statement-breakpoint

ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "outcome_at" TIMESTAMP WITH TIME ZONE;

--> statement-breakpoint

ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "outcome_summary" TEXT;

--> statement-breakpoint

ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "outcome_error" TEXT;

--> statement-breakpoint

ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "outcome_progress" JSONB;

--> statement-breakpoint

ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

--> statement-breakpoint

-- One-shot CHECK: outcome_status must be one of the five terminal states.
-- Conditional add so re-running the migration is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'action_records_outcome_status_check'
  ) THEN
    ALTER TABLE "action_records"
      ADD CONSTRAINT "action_records_outcome_status_check"
      CHECK ("outcome_status" IN ('pending', 'completed', 'partial', 'failed', 'lost_confirmation'));
  END IF;
END $$;

--> statement-breakpoint

-- Partial index for the cron sweep: only pending rows. Keeps the sweep cheap
-- regardless of total table volume.
CREATE INDEX IF NOT EXISTS "action_records_pending_outcome_idx"
  ON "action_records" ("created_at")
  WHERE "outcome_status" = 'pending';

--> statement-breakpoint

-- Conditional unique index for idempotency. Optional column — only enforces
-- when an agent supplies a key. Scoped per org so two orgs can independently
-- use the same key without colliding.
CREATE UNIQUE INDEX IF NOT EXISTS "action_records_idempotency_idx"
  ON "action_records" ("org_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
