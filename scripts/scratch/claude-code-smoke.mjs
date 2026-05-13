#!/usr/bin/env node
/**
 * Phase 1 smoke script — proves the pure `app/lib/claude-code/` tree works
 * without any DB or HTTP. Reads a fixture JSONL slice, runs the parser, then
 * builds an Optimal Files bundle with stub inputs.
 *
 * Run: node scripts/scratch/claude-code-smoke.mjs
 */

import { parseSessionLines } from '../../app/lib/claude-code/parser.js';
import { buildOptimalFilesBundle } from '../../app/lib/claude-code/optimal-files/bundle.js';

const fixture = [
  {
    type: 'assistant',
    sessionId: 'smoke-session-1',
    uuid: 'u1',
    requestId: 'R1',
    timestamp: '2026-05-13T12:00:00Z',
    cwd: 'C:/Projects/Demo',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      id: 'M1',
      content: [{ type: 'tool_use', name: 'Read', id: 't1', input: { file_path: 'src/index.js' } }],
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 4000,
      },
    },
  },
  {
    type: 'assistant',
    sessionId: 'smoke-session-1',
    uuid: 'u2',
    requestId: 'R1',
    timestamp: '2026-05-13T12:00:01Z',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      id: 'M1',
      content: [{ type: 'text', text: 'this is a duplicate fragment' }],
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 4000,
      },
    },
  },
  {
    type: 'user',
    sessionId: 'smoke-session-1',
    uuid: 'u3',
    timestamp: '2026-05-13T12:00:02Z',
    message: { role: 'user', content: [{ type: 'text', text: '/goal Build the smoke fixture' }] },
  },
].map(JSON.stringify);

const parsed = parseSessionLines(fixture);
console.log('parsed session:');
console.log('  sessionUuid:', parsed.sessionUuid);
console.log('  modelPrimary:', parsed.modelPrimary);
console.log('  jsonlRecords:', parsed.jsonlRecords);
console.log('  modelRequests:', parsed.modelRequests, '(expected: 1)');
console.log('  duplicateFragmentsSkipped:', parsed.duplicateFragmentsSkipped, '(expected: 1)');
console.log('  totals:', parsed.totals);
console.log('  cost_usd:', parsed.cost_usd);

const sessionRow = {
  id: 'cs_smoke',
  session_uuid: parsed.sessionUuid,
  source_file: '/tmp/smoke.jsonl',
  parser_version: parsed.parserVersion,
  model_primary: parsed.modelPrimary,
  cost_usd: parsed.cost_usd,
  naive_cost_usd: parsed.naiveCostUsd,
  message_count: parsed.messageCount,
};

const toolEvents = parsed.toolUses.map(t => ({ name: t.name, target: t.target, requestId: t.requestId }));

const bundle = buildOptimalFilesBundle({
  session: sessionRow,
  project: { id: 'cp_smoke', slug: 'smoke-demo', cwd: 'C:/tmp/smoke' },
  toolEvents,
  projectCwd: 'C:/tmp/smoke',
  projectMedianCost: null,
  similarSessionCount: 0,
  projectFiles: new Map(),
  existingPaths: null,
  now: new Date('2026-05-13T12:00:00Z'),
});

console.log('\noptimal files bundle:');
console.log('  files:', bundle.bundle.length);
console.log('  groups.recommended_now:', bundle.groups.recommended_now.length);
console.log('  groups.optional:', bundle.groups.optional.length);
console.log('  groups.not_recommended_yet:', bundle.groups.not_recommended_yet.length);
for (const f of bundle.bundle) {
  console.log(`   - ${f.path} (${f.kind}, confidence=${f.confidence}, overwriteRisk=${f.overwriteRisk})`);
}

console.log('\nsmoke OK');
