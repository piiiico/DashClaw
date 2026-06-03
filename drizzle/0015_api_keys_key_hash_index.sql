-- Index the hottest auth-lookup column. middleware.js resolveApiKey() looks up
-- api_keys by key_hash on every authenticated request that misses the short-lived
-- in-process cache; without an index this is a sequential scan on the most
-- security- and latency-sensitive query in the system. key_hash is a SHA-256
-- digest (effectively unique), but a plain btree index is used rather than UNIQUE
-- to keep this migration safe against any pre-existing duplicate rows.
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash
  ON api_keys(key_hash);
