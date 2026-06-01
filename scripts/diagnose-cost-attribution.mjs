#!/usr/bin/env node

/**
 * Diagnose why `cost_estimate` is $0 for some agents.
 *
 * Breaks the "tokens → model → cost" pipeline into three visible columns
 * so it's obvious where attribution is dropping:
 *
 *   with_tokens = 0            → agent isn't reporting token usage. Often
 *                                CORRECT: the agent makes no LLM calls (it
 *                                records governance/transactional actions like
 *                                apply/sync/review/finance), or it calls
 *                                providers directly and bypasses the gateway's
 *                                llm_output event. A real gap only if this agent
 *                                SHOULD report (then push tokens via the SDK, or
 *                                route LLM calls through OpenClaw). Check its
 *                                action_type before assuming the pipeline broke.
 *   with_tokens > 0, model = 0 → llm_output has no `model` field; set
 *                                DASHCLAW_DEFAULT_MODEL (plugin v1.2.3+) or
 *                                upgrade the runtime
 *   with_model > 0, cost = 0   → the model string isn't in DashClaw's
 *                                pricing table; add it via Settings > Model
 *                                Pricing, or fix its name on the agent side
 *
 * Auto-discovers your org(s) from the DB; pass `--org <org_id>` to target
 * a specific one, or `--days N` to change the lookback window (default 30).
 *
 * Usage:
 *   npm run diagnose:cost
 *   node scripts/diagnose-cost-attribution.mjs --org org_xxx --days 14
 */

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

import './_load-env.mjs';
import { createSqlFromEnv } from './_db.mjs';

function getArg(name) {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const targetOrg = getArg('org');
const days = Number(getArg('days')) || 30;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (add to .env.local or export it)');
  process.exit(1);
}

const sql = createSqlFromEnv();

function pct(n, total) {
  if (!total) return '  0%';
  const v = Math.round((n / total) * 100);
  return String(v).padStart(3) + '%';
}

function pad(s, w) {
  s = String(s);
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

function verdict(row) {
  const { with_tokens, with_model, with_cost } = row;
  if (with_cost > 0 && with_model > 0) return 'OK';
  if (with_tokens === 0) return '0 tokens (often correct: no LLM calls, or direct calls bypass the gateway - check action_type)';
  if (with_model === 0) return 'tokens but no model — set DASHCLAW_DEFAULT_MODEL';
  if (with_cost === 0) return 'model unknown to pricing table — add via Settings';
  return 'unknown';
}

async function diagnoseOrg(orgId, orgName) {
  const rows = await sql.query(
    `SELECT
       agent_id,
       COUNT(*)::int                                                                  AS actions,
       COUNT(*) FILTER (WHERE tokens_in > 0 OR tokens_out > 0)::int                   AS with_tokens,
       COUNT(*) FILTER (WHERE model IS NOT NULL AND model <> '')::int                 AS with_model,
       COUNT(*) FILTER (WHERE cost_estimate > 0)::int                                 AS with_cost,
       COALESCE(SUM(cost_estimate), 0)::real                                          AS total_cost,
       TO_CHAR(MAX(timestamp_start::timestamptz) AT TIME ZONE 'UTC', 'YYYY-MM-DD')    AS last_seen
     FROM action_records
     WHERE org_id = $1
       AND timestamp_start::timestamptz >= NOW() - ($2 || ' days')::interval
     GROUP BY agent_id
     ORDER BY actions DESC`,
    [orgId, String(days)]
  );

  console.log('');
  console.log('━'.repeat(120));
  console.log(`Org: ${orgName || orgId}  (${orgId})`);
  console.log(`Window: last ${days} days · Agents with activity: ${rows.length}`);
  console.log('━'.repeat(120));

  if (rows.length === 0) {
    console.log('  (no action_records in this window)');
    return;
  }

  const header =
    pad('agent_id', 28) +
    pad('actions', 10) +
    pad('tok', 7) +
    pad('tok%', 6) +
    pad('mdl', 7) +
    pad('mdl%', 6) +
    pad('cost', 7) +
    pad('cost%', 7) +
    pad('total $', 12) +
    pad('last seen', 12) +
    'verdict';
  console.log(header);
  console.log('-'.repeat(120));

  for (const r of rows) {
    const line =
      pad(r.agent_id || '(null)', 28) +
      pad(r.actions, 10) +
      pad(r.with_tokens, 7) +
      pad(pct(r.with_tokens, r.actions), 6) +
      pad(r.with_model, 7) +
      pad(pct(r.with_model, r.actions), 6) +
      pad(r.with_cost, 7) +
      pad(pct(r.with_cost, r.actions), 7) +
      pad('$' + Number(r.total_cost || 0).toFixed(2), 12) +
      pad(r.last_seen || '-', 12) +
      verdict(r);
    console.log(line);
  }
}

async function run() {
  const orgs = targetOrg
    ? await sql.query('SELECT id, name FROM organizations WHERE id = $1', [targetOrg])
    : await sql.query('SELECT id, name FROM organizations ORDER BY created_at ASC');

  if (orgs.length === 0) {
    console.error(targetOrg
      ? `No organization found with id "${targetOrg}"`
      : 'No organizations found in this database.');
    process.exit(1);
  }

  console.log(`\nFound ${orgs.length} org(s). Running diagnostic...`);
  for (const org of orgs) {
    await diagnoseOrg(org.id, org.name);
  }

  console.log('');
  console.log('Legend:');
  console.log('  tok   = rows with tokens_in or tokens_out > 0');
  console.log('  mdl   = rows with a non-null model string');
  console.log('  cost  = rows with cost_estimate > 0');
  console.log('  % columns = share of this agent\'s actions that satisfy that condition');
  console.log('');

  if (typeof sql.end === 'function') await sql.end({ timeout: 5 });
}

run().catch((err) => {
  console.error('diagnose failed:', err.message || err);
  process.exit(1);
});
