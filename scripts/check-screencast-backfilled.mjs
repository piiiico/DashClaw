#!/usr/bin/env node
// STATUS:deferred — this script is NOT wired into package.json, CI, or the
// pre-commit pipeline. It fails against current repo state (SCREENCAST_URL
// placeholders remain in app/guides/claude-code/page.js). Do not run as a
// gate until the screencasts are recorded and placeholders replaced.
// See finding: unwired-failing-check-scripts
//
// check-screencast-backfilled.mjs — asserts every <SCREENCAST_URL> placeholder
// has been backfilled with a real watch URL.
//
// Added by plan 03-01 (DOG-02). Closes Phase 2 CCI-05 backfill gap.
//
// Matches BOTH forms (per Phase 2 02-01-SUMMARY §3 warning):
//   - Raw:            <SCREENCAST_URL>
//   - HTML-entity:    &lt;SCREENCAST_URL&gt;
//
// Passes when zero matches remain in README.md + app/guides/claude-code/page.js.

import { readFileSync } from 'node:fs';

const FILES = [
  'README.md',
  'app/guides/claude-code/page.js',
];

const PATTERN = /(&lt;|<)SCREENCAST_URL(&gt;|>)/g;

let totalMatches = 0;
const findings = [];

for (const file of FILES) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    const matches = line.match(PATTERN);
    if (matches) {
      totalMatches += matches.length;
      findings.push({ file, line: idx + 1, snippet: line.trim().slice(0, 120) });
    }
  });
}

if (totalMatches === 0) {
  console.log('check-screencast-backfilled: OK (zero placeholders remain)');
  process.exit(0);
}

console.error(`check-screencast-backfilled: FAIL — ${totalMatches} placeholder(s) remain:`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  ${f.snippet}`);
}
process.exit(1);
