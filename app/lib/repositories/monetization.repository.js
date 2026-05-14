/**
 * Monetization repository — counter for MON-01 "verified integrations"
 * trigger. Encapsulates SQL per CLAUDE.md route-SQL guardrail so the
 * public /api/monetization/verified-integrations-count route file stays
 * repository-only (baseline route-SQL count unchanged).
 *
 * Assumption A8 resolution:
 *   hooks/dashclaw_pretool.py:75 — AGENT_ID defaults to "claude-code"; users
 *   MAY override via DASHCLAW_AGENT_ID=<custom> (e.g. "claude-code-wes-laptop").
 *   Canonical match: agent_id ILIKE 'claude-code%' — catches default + overrides.
 *
 * Multi-agent expansion (post-Hermes / Codex parity):
 *   Codex installs default agent_id="codex"; Hermes Agent plugin defaults to
 *   agent_id="hermes". All three count toward the same trigger so the
 *   "50 verified coding-agent integrations" commitment captures every
 *   governed coding agent surface DashClaw ships installers for.
 *
 * Exclusions (D-01 "in the wild"):
 *   org_default (founder's own instance) and org_demo (demo sandbox) are
 *   excluded by default. Override via excludeOrgIds option.
 *
 * Recency (D-01):
 *   Default 90-day window prunes stale one-off integrations so the counter
 *   reflects "in the wild" activity, not historical activation.
 *
 * Added by Plan 03-03.
 */

/**
 * @param {object} sql - Neon tagged-template SQL driver (getSql() result)
 * @param {object} [options]
 * @param {string[]} [options.excludeOrgIds=['org_default','org_demo']]
 * @param {number}   [options.recencyDays=90]
 * @returns {Promise<number>} COUNT(DISTINCT org_id) as a plain integer
 */
export async function countVerifiedIntegrations(sql, options = {}) {
  const excludeOrgIds = options.excludeOrgIds ?? ['org_default', 'org_demo'];
  const recencyDays = options.recencyDays ?? 90;

  const rows = await sql`
    SELECT COUNT(DISTINCT org_id)::int AS count
    FROM action_records
    WHERE (
        agent_id ILIKE 'claude-code%'
        OR agent_id ILIKE 'codex%'
        OR agent_id ILIKE 'hermes%'
      )
      AND org_id <> ALL(${excludeOrgIds})
      AND timestamp_start::timestamptz > NOW() - (${recencyDays} * INTERVAL '1 day')
  `;
  return rows[0]?.count ?? 0;
}
