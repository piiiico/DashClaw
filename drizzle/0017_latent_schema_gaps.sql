-- Remediate three latent schema gaps surfaced by a DB-verified audit (2026-06-04).
-- All steps are idempotent (dedup-then-create / IF NOT EXISTS) and safe to re-run,
-- matching the auto-migrate Step-1 contract (every .sql re-runs on every deploy).

-- 1. token_budgets — upsertTokenBudget() does
--    `ON CONFLICT (org_id, COALESCE(agent_id, ''))` but no backing unique index
--    exists (only the PK on id), so every budget upsert throws "no unique or
--    exclusion constraint matching the ON CONFLICT specification". Its sibling
--    daily_totals already has the equivalent NULL-safe expression index; this was
--    simply missed. Dedup existing rows (keep the physically-last per key), then add
--    the index. A plain UNIQUE CONSTRAINT can't express COALESCE(), so this must be
--    an expression INDEX inferred by `ON CONFLICT (expr-list)`.
DELETE FROM token_budgets a
  USING token_budgets b
  WHERE a.org_id = b.org_id
    AND COALESCE(a.agent_id, '') = COALESCE(b.agent_id, '')
    AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS token_budgets_org_agent_unique
  ON token_budgets (org_id, COALESCE(agent_id, ''));

-- 2. message_attachments — the live /api/messages attachment path
--    (createAttachment / getAttachmentsForMessages / getAttachmentWithData /
--    getOrgAttachmentBytes) references this table, but no migration ever created it.
--    Read callers try/catch it as optional (so listing degrades), but sending an
--    attachment 500s. Columns mirror app/lib/repositories/messagesContext.repository.js.
CREATE TABLE IF NOT EXISTS message_attachments (
  id          text PRIMARY KEY,
  org_id      text NOT NULL,
  message_id  text,
  filename    text,
  mime_type   text,
  size_bytes  bigint,
  data        text,
  created_at  timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_org_message
  ON message_attachments (org_id, message_id);

-- 3. prompt_injection_scans — the live /api/security/prompt-injection route records
--    scan metadata here (insertScan) and lists history (listScans), but no migration
--    created it. insertScan is .catch-guarded so scanning still works; the history
--    list 500s. Columns mirror app/lib/repositories/promptInjection.repository.js.
CREATE TABLE IF NOT EXISTS prompt_injection_scans (
  id             text PRIMARY KEY,
  org_id         text NOT NULL,
  agent_id       text,
  content_hash   text,
  findings_count integer DEFAULT 0,
  critical_count integer DEFAULT 0,
  categories     jsonb DEFAULT '[]'::jsonb,
  risk_level     text,
  recommendation text,
  source         text,
  scanned_at     timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_injection_scans_org_scanned
  ON prompt_injection_scans (org_id, scanned_at DESC);
