-- Code Sessions tables — AgentLens absorption Phase 2.
-- Eight new tables for ingested Claude Code transcripts (hook-driven and
-- JSONL-driven), associated message/tool-use rows, signals, alerts, weekly
-- memos, and Optimal Files manifests.

CREATE TABLE IF NOT EXISTS "code_projects" (
  "id"           text PRIMARY KEY,
  "org_id"       text NOT NULL REFERENCES "organizations"("id"),
  "slug"         text NOT NULL,
  "cwd"          text,
  "source_host"  text,
  "created_at"   timestamptz DEFAULT NOW(),
  "updated_at"   timestamptz DEFAULT NOW()
);

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "code_projects_org_slug_unique"
  ON "code_projects" ("org_id", "slug");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "code_sessions" (
  "id"                            text PRIMARY KEY,
  "org_id"                        text NOT NULL REFERENCES "organizations"("id"),
  "project_id"                    text NOT NULL REFERENCES "code_projects"("id"),
  "session_uuid"                  text NOT NULL,
  "source"                        text NOT NULL,
  "source_file"                   text,
  "source_mtime"                  text,
  "started_at"                    text,
  "ended_at"                      text,
  "message_count"                 integer NOT NULL DEFAULT 0,
  "model_primary"                 text,
  "input_tokens"                  integer NOT NULL DEFAULT 0,
  "output_tokens"                 integer NOT NULL DEFAULT 0,
  "cache_read_tokens"             integer NOT NULL DEFAULT 0,
  "cache_creation_tokens"         integer NOT NULL DEFAULT 0,
  "cost_usd"                      numeric NOT NULL DEFAULT 0,
  "cache_savings_usd"             numeric NOT NULL DEFAULT 0,
  "stuck_loops"                   integer NOT NULL DEFAULT 0,
  "model_requests"                integer NOT NULL DEFAULT 0,
  "jsonl_records"                 integer NOT NULL DEFAULT 0,
  "duplicate_fragments_skipped"   integer NOT NULL DEFAULT 0,
  "naive_input_tokens"            integer NOT NULL DEFAULT 0,
  "naive_output_tokens"           integer NOT NULL DEFAULT 0,
  "naive_cache_read_tokens"       integer NOT NULL DEFAULT 0,
  "naive_cache_creation_tokens"   integer NOT NULL DEFAULT 0,
  "naive_cost_usd"                numeric NOT NULL DEFAULT 0,
  "parser_version"                integer NOT NULL DEFAULT 2,
  "created_at"                    timestamptz DEFAULT NOW(),
  "updated_at"                    timestamptz DEFAULT NOW(),
  CONSTRAINT "code_sessions_source_check" CHECK ("source" IN ('hook', 'jsonl'))
);

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "code_sessions_org_uuid_unique"
  ON "code_sessions" ("org_id", "session_uuid");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "code_session_messages" (
  "id"                       serial PRIMARY KEY,
  "session_id"               text NOT NULL REFERENCES "code_sessions"("id") ON DELETE CASCADE,
  "uuid"                     text,
  "role"                     text,
  "model"                    text,
  "timestamp"                text,
  "input_tokens"             integer,
  "output_tokens"            integer,
  "cache_read_tokens"        integer,
  "cache_creation_tokens"    integer,
  "cost_usd"                 numeric,
  "text_preview"             text,
  "request_id"               text,
  "message_id"               text
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "code_session_messages_session_idx"
  ON "code_session_messages" ("session_id");

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "code_session_messages_request_idx"
  ON "code_session_messages" ("session_id", "request_id");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "code_session_tool_uses" (
  "id"            serial PRIMARY KEY,
  "session_id"    text NOT NULL REFERENCES "code_sessions"("id") ON DELETE CASCADE,
  "message_id"    integer REFERENCES "code_session_messages"("id") ON DELETE SET NULL,
  "action_id"     text REFERENCES "action_records"("action_id") ON DELETE SET NULL,
  "name"          text NOT NULL,
  "target"        text,
  "timestamp"     text,
  "duration_ms"   integer,
  "tool_use_id"   text,
  "request_id"    text,
  "source_line"   integer
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "code_session_tool_uses_session_name_idx"
  ON "code_session_tool_uses" ("session_id", "name");

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "code_session_tool_uses_session_request_idx"
  ON "code_session_tool_uses" ("session_id", "request_id");

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "code_session_tool_uses_action_idx"
  ON "code_session_tool_uses" ("action_id");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "code_session_signals" (
  "id"           serial PRIMARY KEY,
  "session_id"   text NOT NULL REFERENCES "code_sessions"("id") ON DELETE CASCADE,
  "kind"         text NOT NULL,
  "confidence"   text,
  "savings_usd"  numeric,
  "payload"      jsonb,
  "created_at"   timestamptz DEFAULT NOW()
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "code_session_signals_session_kind_idx"
  ON "code_session_signals" ("session_id", "kind");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "code_session_alerts" (
  "id"           serial PRIMARY KEY,
  "org_id"       text NOT NULL REFERENCES "organizations"("id"),
  "project_id"   text REFERENCES "code_projects"("id") ON DELETE CASCADE,
  "session_id"   text REFERENCES "code_sessions"("id") ON DELETE CASCADE,
  "kind"         text NOT NULL,
  "severity"     text NOT NULL DEFAULT 'info',
  "scope"        text NOT NULL DEFAULT 'session',
  "title"        text NOT NULL,
  "body"         text,
  "read_at"      timestamptz,
  "created_at"   timestamptz DEFAULT NOW()
);

--> statement-breakpoint

-- NULL-safe dedup unique index. Postgres treats NULLs as distinct in plain
-- UNIQUE constraints, so we project NULLs to '' via COALESCE. Named for
-- ON CONFLICT ON CONSTRAINT use in the alerts upsert path.
CREATE UNIQUE INDEX IF NOT EXISTS "code_session_alerts_dedup"
  ON "code_session_alerts" (
    "org_id",
    "kind",
    COALESCE("project_id", ''),
    COALESCE("session_id", '')
  );

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "code_session_memos" (
  "id"            serial PRIMARY KEY,
  "org_id"        text NOT NULL REFERENCES "organizations"("id"),
  "project_id"    text NOT NULL REFERENCES "code_projects"("id") ON DELETE CASCADE,
  "iso_week_tag"  text NOT NULL,
  "body_md"       text,
  "created_at"    timestamptz DEFAULT NOW()
);

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "code_session_memos_org_project_week_unique"
  ON "code_session_memos" ("org_id", "project_id", "iso_week_tag");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "code_optimal_file_manifests" (
  "id"            text PRIMARY KEY,
  "org_id"        text NOT NULL REFERENCES "organizations"("id"),
  "session_id"    text NOT NULL REFERENCES "code_sessions"("id") ON DELETE CASCADE,
  "project_cwd"   text NOT NULL,
  "plan"          jsonb NOT NULL,
  "expires_at"    timestamptz NOT NULL,
  "created_at"    timestamptz DEFAULT NOW()
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "code_optimal_file_manifests_expires_idx"
  ON "code_optimal_file_manifests" ("expires_at");
