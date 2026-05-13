#!/usr/bin/env node
/**
 * Export marketing-funnel events from Redis to stdout as CSV.
 *
 * Usage:
 *   node scripts/export-marketing-events.mjs --from 2026-05-01 --to 2026-05-13
 *   node scripts/export-marketing-events.mjs --days 30 > events.csv
 *
 * Reads from REDIS_URL (or REALTIME_REDIS_URL). Each day's events live
 * under the list key `marketing:events:YYYY-MM-DD` written by
 * app/lib/marketingEvents.js with a 90-day TTL.
 *
 * Output columns: timestamp, event, ip, properties_json. Properties are
 * collapsed into a single JSON column so awk/cut consumers can leave
 * them alone or jq-parse them.
 */

import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL || process.env.REALTIME_REDIS_URL || '';
if (!REDIS_URL) {
  console.error('REDIS_URL is not set. Set it before running this script.');
  process.exit(1);
}

function parseArgs(argv) {
  const args = { from: null, to: null, days: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--days') args.days = parseInt(argv[++i], 10);
  }
  return args;
}

function ymd(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function buildDateRange({ from, to, days }) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let start;
  let end;

  if (from) {
    start = new Date(`${from}T00:00:00Z`);
    end = to ? new Date(`${to}T00:00:00Z`) : today;
  } else if (Number.isFinite(days) && days > 0) {
    end = today;
    start = new Date(today);
    start.setUTCDate(start.getUTCDate() - days + 1);
  } else {
    end = today;
    start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 6);
  }

  const out = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    out.push(ymd(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function csvEscape(value) {
  if (value == null) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const days = buildDateRange(args);

  const client = createClient({ url: REDIS_URL });
  client.on('error', (err) => console.error('[REDIS]', err?.message || err));
  await client.connect();

  process.stdout.write('timestamp,event,ip,properties\n');

  let total = 0;
  for (const day of days) {
    const key = `marketing:events:${day}`;
    const items = await client.LRANGE(key, 0, -1);
    for (const raw of items) {
      let record;
      try {
        record = JSON.parse(raw);
      } catch {
        continue;
      }
      const row = [
        csvEscape(record.timestamp || ''),
        csvEscape(record.event || ''),
        csvEscape(record.ip || ''),
        csvEscape(JSON.stringify(record.properties || {})),
      ].join(',');
      process.stdout.write(`${row}\n`);
      total++;
    }
  }

  await client.quit();
  console.error(`Exported ${total} events across ${days.length} day(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
