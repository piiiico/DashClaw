#!/usr/bin/env node
/**
 * Operator-run repair script for orphan code_sessions rows.
 *
 * A crash mid-upsertSessionWithChildren can leave a session row whose
 * children (messages, tool_uses) were deleted but never re-inserted. This
 * script finds those orphans and (for source='jsonl' rows whose source_file
 * still exists on disk) re-ingests them. Sessions with source='hook' or
 * missing source_file are listed so the operator can decide whether to
 * delete or wait for the next live turn to re-populate.
 *
 * Usage:
 *   node scripts/repair-code-sessions.mjs                # list orphans, no writes
 *   node scripts/repair-code-sessions.mjs --apply        # repair via re-ingest
 */

import fs from 'node:fs';
import { getSql } from '../app/lib/db.js';
import { parseSessionFile } from '../app/lib/claude-code/parser.js';
import {
  upsertSessionWithChildren,
} from '../app/lib/repositories/code-sessions.repository.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  const sql = getSql();
  const orphans = await sql`
    SELECT s.id, s.org_id, s.project_id, s.session_uuid, s.source, s.source_file,
           s.parser_version,
           (SELECT COUNT(*) FROM code_session_messages m WHERE m.session_id = s.id) AS msg_count
    FROM code_sessions s
    WHERE NOT EXISTS (
      SELECT 1 FROM code_session_messages m WHERE m.session_id = s.id LIMIT 1
    )
    ORDER BY s.created_at DESC
  `;
  if (!orphans.length) {
    console.log('No orphan code_sessions rows.');
    return;
  }
  console.log(`Found ${orphans.length} orphan code_sessions row(s).`);
  let repaired = 0;
  let skipped = 0;
  for (const o of orphans) {
    const canRepair = o.source === 'jsonl' && o.source_file && fs.existsSync(o.source_file);
    const status = canRepair ? 'repairable_via_jsonl' : 'needs_operator_attention';
    console.log(`  ${o.id} org=${o.org_id} source=${o.source} -> ${status}`);
    if (!APPLY || !canRepair) { skipped++; continue; }
    try {
      const parsed = await parseSessionFile(o.source_file);
      const result = await upsertSessionWithChildren(sql, o.org_id, parsed, {
        projectId: o.project_id,
        source: o.source,
      });
      if (!result.skipped) {
        console.log(`    re-ingested -> ${result.insertedMessages} messages, ${result.insertedToolUses} tool_uses`);
        repaired++;
      }
    } catch (err) {
      console.log(`    repair failed: ${err.message}`);
    }
  }
  console.log(`\nDone. Repaired ${repaired}, skipped ${skipped}.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
