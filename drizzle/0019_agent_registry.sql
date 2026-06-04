-- 0019_agent_registry.sql
-- Agent Registry (SPEC-mega.md Group C): org-owned, delegatable external
-- providers that group existing capabilities, plus a thin invocation record
-- that references the existing action + capability rather than duplicating
-- their fields. Org-scoped, idempotent, Postgres-only.

CREATE TABLE IF NOT EXISTS "registered_agents" (
  "entry_id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "endpoint" TEXT,
  "auth_type" TEXT NOT NULL DEFAULT 'none',
  "auth_metadata" JSONB DEFAULT '{}'::jsonb,
  "risk_class" TEXT NOT NULL DEFAULT 'medium',
  "default_budget_usd" REAL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "metadata" JSONB DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "registered_agents_org_slug_unique" ON "registered_agents" ("org_id", "slug");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "registered_agent_capabilities" (
  "id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "registered_agent_id" TEXT NOT NULL,
  "capability_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT "registered_agent_capabilities_unique" UNIQUE ("org_id", "registered_agent_id", "capability_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_registered_agent_capabilities_agent" ON "registered_agent_capabilities" ("org_id", "registered_agent_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_invocations" (
  "id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "registered_agent_id" TEXT NOT NULL,
  "capability_id" TEXT,
  "action_id" TEXT,
  "caller_agent_id" TEXT,
  "created_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_invocations_agent" ON "agent_invocations" ("org_id", "registered_agent_id", "created_at");
