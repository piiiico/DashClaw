-- Add hosted_mode and trial cap columns to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS hosted_mode BOOLEAN NOT NULL DEFAULT FALSE;

--> statement-breakpoint

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_action_cap INTEGER;

--> statement-breakpoint

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_actions_used INTEGER NOT NULL DEFAULT 0;

--> statement-breakpoint

-- Add scope column to api_keys
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scope TEXT;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS organizations_hosted_mode_idx ON organizations(hosted_mode) WHERE hosted_mode = TRUE;
