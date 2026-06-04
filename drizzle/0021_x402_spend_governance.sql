-- x402 spend governance: provider registry + purchase detail (keyed 1:1 to action_records.action_id)
CREATE TABLE IF NOT EXISTS "x402_providers" (
  "provider_id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'research',
  "base_url" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "default_currency" TEXT NOT NULL DEFAULT 'USDC',
  "pricing_model" TEXT,
  "metadata" JSONB DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "x402_providers_org_slug_unique" ON "x402_providers" ("org_id", "slug");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "x402_endpoints" (
  "endpoint_id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "provider_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "endpoint_url" TEXT,
  "category" TEXT NOT NULL DEFAULT 'research',
  "sensitivity_level" TEXT NOT NULL DEFAULT 'low',
  "default_price" REAL,
  "price_unit" TEXT DEFAULT 'per_call',
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "metadata" JSONB DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_x402_endpoints_provider" ON "x402_endpoints" ("org_id", "provider_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "x402_endpoints_provider_slug_unique" ON "x402_endpoints" ("org_id", "provider_id", "slug");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "x402_purchases" (
  "action_id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "provider_id" TEXT,
  "endpoint_id" TEXT,
  "agent_id" TEXT,
  "spend_amount" REAL NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USDC',
  "payment_method" TEXT,
  "wallet_reference" TEXT,
  "payment_reference" TEXT,
  "purchase_reason" TEXT,
  "context_gap" TEXT,
  "alternatives_considered" TEXT,
  "expected_value" TEXT,
  "execution_status" TEXT NOT NULL DEFAULT 'pending',
  "result_summary" TEXT,
  "result_reference" TEXT,
  "value_score" REAL,
  "confidence_score" REAL,
  "operator_feedback" TEXT,
  "failure_reason" TEXT,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "completed_at" TIMESTAMPTZ
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_x402_purchases_provider" ON "x402_purchases" ("org_id", "provider_id", "created_at");
