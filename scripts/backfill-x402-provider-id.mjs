#!/usr/bin/env node

/**
 * Backfill `provider_id` on historical `x402_purchases` rows that were recorded
 * with a free-text provider name but no provider_id.
 *
 * Background: POST /api/x402/purchases accepted `provider` (a name/origin) for
 * guard context but only persisted `provider_id`, so any caller that didn't
 * pre-register a provider (the SDK self-report path, an MCP tool, a wrapper)
 * left `x402_purchases.provider_id = NULL` — which renders as a BLANK provider
 * cell on Spend → x402 even though the spend itself is correct. The route now
 * resolves/auto-registers a provider_id server-side (resolveProviderByName), so
 * no NEW null rows occur; this repairs the ones written before that fix.
 *
 * The provider origin is recovered from the purchase's own `purchase_reason` /
 * `context_gap` text (e.g. "Paid x402 capability call to stableenrich.dev"),
 * resolved to a provider via the SAME resolveProviderByName the route uses, and
 * written back. Rows whose origin can't be recovered are reported and skipped.
 * Already-attributed rows (provider_id NOT NULL) are never touched.
 *
 * Dry-run by default and SIDE-EFFECT-FREE in dry-run (it only LOOKS UP existing
 * providers; it never auto-registers until --apply).
 *
 * Usage:
 *   node scripts/backfill-x402-provider-id.mjs                      (dry-run, all orgs)
 *   node scripts/backfill-x402-provider-id.mjs --org org_xxx        (scope to one org)
 *   node scripts/backfill-x402-provider-id.mjs --provider host.dev  (force this origin for unrecoverable rows)
 *   node scripts/backfill-x402-provider-id.mjs --apply              (write the change)
 */

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

import './_load-env.mjs';
import { createSqlFromEnv } from './_db.mjs';
import { resolveProviderByName } from '../app/lib/repositories/x402.repository.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const orgIdx = args.indexOf('--org');
const targetOrg = orgIdx !== -1 ? args[orgIdx + 1] : null;
const provIdx = args.indexOf('--provider');
const forcedProvider = provIdx !== -1 ? args[provIdx + 1] : null;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (add to .env.local or export it)');
  process.exit(1);
}

const sql = createSqlFromEnv();

// Mirror the repository's slugify so the dry-run lookup matches what
// resolveProviderByName would do under --apply.
function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 64) || 'provider';
}

// First hostname-looking token in a free-text field (e.g. the provider origin
// inside "Paid x402 capability call to stableenrich.dev").
function extractOrigin(...texts) {
  for (const t of texts) {
    const match = String(t || '').match(/\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})\b/i);
    if (match) return match[1];
  }
  return null;
}

// Read-only provider lookup for dry-run (no auto-register).
async function findProvider(orgId, name) {
  const rows = await sql.query(
    `SELECT provider_id, name FROM x402_providers
       WHERE org_id = $1 AND (slug = $2 OR LOWER(name) = $3)
       ORDER BY created_at ASC LIMIT 1`,
    [orgId, slugify(name), String(name).toLowerCase()],
  );
  return rows[0] || null;
}

async function main() {
  const rows = targetOrg
    ? await sql.query(
        `SELECT action_id, org_id, purchase_reason, context_gap, spend_amount, currency
           FROM x402_purchases WHERE provider_id IS NULL AND org_id = $1
           ORDER BY created_at ASC`,
        [targetOrg],
      )
    : await sql.query(
        `SELECT action_id, org_id, purchase_reason, context_gap, spend_amount, currency
           FROM x402_purchases WHERE provider_id IS NULL
           ORDER BY created_at ASC`,
        [],
      );

  console.log(`\nFound ${rows.length} purchase row(s) with a null provider_id${targetOrg ? ` in ${targetOrg}` : ''}.`);
  if (rows.length === 0) {
    console.log('Nothing to backfill.\n');
    return;
  }

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const origin = forcedProvider || extractOrigin(row.purchase_reason, row.context_gap);
    if (!origin) {
      console.log(`  SKIP  ${row.action_id}  (no recoverable origin; pass --provider <host> to force)`);
      skipped += 1;
      continue;
    }

    if (!apply) {
      const existing = await findProvider(row.org_id, origin);
      const target = existing ? `${existing.provider_id} (reuse "${existing.name}")` : `would auto-register "${origin}"`;
      console.log(`  PLAN  ${row.action_id}  $${row.spend_amount} ${row.currency}  ${origin} -> ${target}`);
      continue;
    }

    const provider = await resolveProviderByName(sql, row.org_id, origin);
    if (!provider?.provider_id) {
      console.log(`  SKIP  ${row.action_id}  (could not resolve provider for "${origin}")`);
      skipped += 1;
      continue;
    }
    // Re-check provider_id IS NULL in the WHERE so a concurrent write isn't
    // clobbered. RETURNING gives a reliable updated-row count — the Neon HTTP
    // driver returns a bare rows array (no rowCount) for a non-RETURNING write.
    const res = await sql.query(
      `UPDATE x402_purchases SET provider_id = $1
         WHERE org_id = $2 AND action_id = $3 AND provider_id IS NULL
         RETURNING action_id`,
      [provider.provider_id, row.org_id, row.action_id],
    );
    const count = Array.isArray(res) ? res.length : (res.rowCount ?? 0);
    console.log(`  SET   ${row.action_id}  ${origin} -> ${provider.provider_id}${count ? '' : ' (no-op; already attributed)'}`);
    updated += count ? 1 : 0;
  }

  console.log(
    apply
      ? `\nDone. Updated ${updated} row(s), skipped ${skipped}.\n`
      : `\nDry-run complete (${rows.length} candidate row(s)). Re-run with --apply to write.\n`,
  );
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
