#!/usr/bin/env node
// STATUS:deferred — this script is NOT wired into package.json, CI, or the
// pre-commit pipeline. It fails against current repo state (README first 50
// lines are missing the /guides/claude-code link). Do not run as a gate until
// the underlying README content is updated and this file is promoted.
// See finding: unwired-failing-check-scripts
//
// check-readme-lead.mjs — asserts the README stays Claude-Code-forward.
//
// Added by plan 02-03 (CCI-05). Optional gate — not wired into npm test or
// the pre-commit pipeline yet. Future phases can promote it to a gate.
//
// Passes when:
//   - README.md first 50 lines contain "Claude Code" (case-insensitive)
//   - README.md first 50 lines contain a link target "/guides/claude-code"

import { readFileSync } from 'node:fs';

const text = readFileSync('README.md', 'utf8');
const first50 = text.split('\n').slice(0, 50).join('\n');

const hasClaudeCode = /claude code/i.test(first50);
const hasGuideLink = /\/guides\/claude-code/.test(first50);

if (!hasClaudeCode) {
  console.error('check-readme-lead: README first 50 lines do not mention "Claude Code"');
  process.exit(1);
}
if (!hasGuideLink) {
  console.error('check-readme-lead: README first 50 lines missing link to /guides/claude-code');
  process.exit(1);
}
console.log('check-readme-lead: OK');
