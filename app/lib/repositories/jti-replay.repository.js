/**
 * JWT replay-protection store (Phase 2b).
 *
 * Design by @piiiico in issue #120. Storage is Postgres (the canonical
 * DashClaw database); the JtiStore interface from the issue collapses to
 * a single repository because we don't need a pluggable backend at this
 * scale.
 *
 * Atomicity: the composite PK (issuer, jti) plus `ON CONFLICT DO NOTHING
 * RETURNING jti` gives us race-free check-and-record in a single round
 * trip — two concurrent invocations with the same jti can both attempt
 * the insert; exactly one returns a row, the other gets an empty result.
 */

// Sweep on ~1% of writes so the table stays bounded under steady-state
// load without depending on the GitHub Actions cron firing. The cron at
// /api/cron/jti-sweep is the belt-and-suspenders for low-traffic periods.
const SWEEP_PROBABILITY = 0.01;

let _tableChecked = false;
async function ensureTable(sql) {
  if (_tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS jwt_replay_log (
      issuer     TEXT   NOT NULL,
      jti        TEXT   NOT NULL,
      expires_at BIGINT NOT NULL,
      seen_at    BIGINT NOT NULL,
      agent_id   TEXT,
      PRIMARY KEY (issuer, jti)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_jwt_replay_log_expires ON jwt_replay_log(expires_at)`;
  _tableChecked = true;
}

/**
 * Atomic "insert if not present" against the replay log. Returns one of:
 *   - 'unique'      first time this (issuer, jti) was seen
 *   - 'replayed'    already seen — caller should treat the token as captured
 *   - 'unavailable' DB unreachable (best_effort default still proceeds;
 *                   required mode fails the guard)
 *
 * Caller MUST have already validated the token signature; this function
 * does not verify anything — it only records and detects duplicates.
 *
 * @param {Function} sql - Neon tagged-template SQL
 * @param {Object} opts
 * @param {string} opts.jti
 * @param {string} opts.issuer
 * @param {number} opts.expiresAt   unix seconds, mirrors JWT exp
 * @param {string} [opts.agentId]   forensic-only
 * @returns {Promise<'unique'|'replayed'|'unavailable'>}
 */
export async function checkAndRecord(sql, { jti, issuer, expiresAt, agentId }) {
  if (!jti || !issuer || typeof expiresAt !== 'number') {
    const err = new Error('checkAndRecord: jti, issuer, expiresAt are required');
    err.code = 'INVALID_INPUT';
    throw err;
  }

  try {
    await ensureTable(sql);
    const seenAt = Math.floor(Date.now() / 1000);
    const rows = await sql`
      INSERT INTO jwt_replay_log (issuer, jti, expires_at, seen_at, agent_id)
      VALUES (${issuer}, ${jti}, ${expiresAt}, ${seenAt}, ${agentId ?? null})
      ON CONFLICT (issuer, jti) DO NOTHING
      RETURNING jti
    `;

    // Probabilistic in-line sweep keeps the table bounded without a cron
    // dependency. Fire-and-forget — sweep failure must never block the
    // verification flow.
    if (Math.random() < SWEEP_PROBABILITY) {
      void sql`DELETE FROM jwt_replay_log WHERE expires_at < ${seenAt}`
        .catch((err) => {
          console.warn('[jti-replay] probabilistic sweep failed:', err.message);
        });
    }

    return rows.length === 1 ? 'unique' : 'replayed';
  } catch (err) {
    console.warn('[jti-replay] store unavailable:', err?.message || err);
    return 'unavailable';
  }
}

/**
 * Delete every row whose expires_at has passed. Returns the count.
 * Called by the /api/cron/jti-sweep endpoint on its 5-minute schedule.
 * Safe to run concurrently — DELETE … WHERE is idempotent.
 *
 * @param {Function} sql
 * @returns {Promise<number>}
 */
export async function sweep(sql) {
  await ensureTable(sql);
  const now = Math.floor(Date.now() / 1000);
  const deleted = await sql`
    DELETE FROM jwt_replay_log
    WHERE expires_at < ${now}
    RETURNING jti
  `;
  return deleted.length;
}

/**
 * Reset the module-level cache. Test-only; never call in production.
 * @internal
 */
export function _resetCacheForTesting() {
  _tableChecked = false;
}
