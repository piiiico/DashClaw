#!/usr/bin/env node
/**
 * report-action.mjs — Create or update ActionRecords via the DashClaw API.
 *
 * Create mode:
 *   node scripts/report-action.mjs --agent-id my-agent --type build --goal "Deploy feature X"
 *
 * Update mode:
 *   node scripts/report-action.mjs --update act_abc123 --status completed --output "Done"
 *
 * Track mode (create + complete in one call):
 *   node scripts/report-action.mjs --agent-id my-agent --type deploy --goal "Push to prod" --status completed --output "Done"
 *
 * Loads DASHCLAW_API_KEY from .env.local. Defaults to Vercel production URL; use --local for localhost:3000.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ACTION_TYPES = [
  'build', 'deploy', 'post', 'apply', 'security', 'message', 'api',
  'calendar', 'research', 'review', 'fix', 'refactor', 'test', 'config',
  'monitor', 'alert', 'cleanup', 'sync', 'migrate', 'other'
];

const ACTION_STATUSES = ['running', 'completed', 'failed', 'cancelled', 'pending'];

// ---------------------------------------------------------------------------
// Load .env.local
// ---------------------------------------------------------------------------
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, 'utf8').split('\n');
  for (const l of lines) {
    const idx = l.indexOf('=');
    if (idx > 0 && !l.startsWith('#')) {
      const key = l.slice(0, idx).trim();
      if (!process.env[key]) {
        process.env[key] = l.slice(idx + 1).trim();
      }
    }
  }
}

function loadEnv() {
  loadEnvFile(resolve(projectRoot, '.env.local'));
  loadEnvFile(resolve(projectRoot, '.env'));
}

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--local') {
      args.local = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg.startsWith('--') && i + 1 < argv.length) {
      const key = arg.slice(2);
      args[key] = argv[++i];
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Build create payload
// ---------------------------------------------------------------------------
function buildCreatePayload(args) {
  const payload = {
    agent_id: args['agent-id'],
    action_type: args.type,
    declared_goal: args.goal,
  };

  if (args['agent-name']) payload.agent_name = args['agent-name'];
  if (args.reasoning) payload.reasoning = args.reasoning;
  if (args.trigger) payload.trigger = args.trigger;
  if (args.parent) payload.parent_action_id = args.parent;

  if (args.systems) {
    payload.systems_touched = args.systems.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (args.risk !== undefined) {
    payload.risk_score = parseInt(args.risk, 10);
  }
  if (args.confidence !== undefined) {
    payload.confidence = parseInt(args.confidence, 10);
  }

  // Track mode: set status + output on create
  if (args.status) payload.status = args.status;
  if (args.output) payload.output_summary = args.output;
  if (args.error) payload.error_message = args.error;

  // If status is completed/failed, set timestamp_end
  if (args.status === 'completed' || args.status === 'failed') {
    payload.timestamp_end = new Date().toISOString();
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Build update payload
// ---------------------------------------------------------------------------
function buildUpdatePayload(args) {
  const payload = {};

  if (args.status) payload.status = args.status;
  if (args.output) payload.output_summary = args.output;
  if (args.error) payload.error_message = args.error;
  if (args.duration) payload.duration_ms = parseInt(args.duration, 10);

  if (args.artifacts) {
    payload.artifacts_created = args.artifacts.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (args['side-effects']) {
    payload.side_effects = args['side-effects'].split(',').map(s => s.trim()).filter(Boolean);
  }

  // If completing/failing, set timestamp_end
  if (args.status === 'completed' || args.status === 'failed') {
    payload.timestamp_end = new Date().toISOString();
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------
function validateCreate(payload) {
  const errors = [];
  if (!payload.agent_id) errors.push('--agent-id is required');
  if (!payload.action_type) errors.push('--type is required');
  if (!payload.declared_goal) errors.push('--goal is required');
  if (payload.action_type && !ACTION_TYPES.includes(payload.action_type)) {
    errors.push(`--type must be one of: ${ACTION_TYPES.join(', ')}`);
  }
  if (payload.status && !ACTION_STATUSES.includes(payload.status)) {
    errors.push(`--status must be one of: ${ACTION_STATUSES.join(', ')}`);
  }
  if (payload.risk_score !== undefined && (payload.risk_score < 0 || payload.risk_score > 100)) {
    errors.push('--risk must be 0-100');
  }
  if (payload.confidence !== undefined && (payload.confidence < 0 || payload.confidence > 100)) {
    errors.push('--confidence must be 0-100');
  }
  return errors;
}

function validateUpdate(payload) {
  const errors = [];
  if (Object.keys(payload).length === 0) {
    errors.push('At least one update field is required (--status, --output, --error, --artifacts, --side-effects, --duration)');
  }
  if (payload.status && !ACTION_STATUSES.includes(payload.status)) {
    errors.push(`--status must be one of: ${ACTION_STATUSES.join(', ')}`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------
async function createAction(baseUrl, apiKey, payload) {
  const url = `${baseUrl}/api/actions`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

async function updateAction(baseUrl, apiKey, actionId, payload) {
  const url = `${baseUrl}/api/actions/${actionId}`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;

  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------
function printUsage() {
  console.log(`Usage:
  Create:  node scripts/report-action.mjs --agent-id <id> --type <type> --goal "<goal>"
  Update:  node scripts/report-action.mjs --update <action_id> --status completed --output "Done"
  Track:   node scripts/report-action.mjs --agent-id <id> --type <type> --goal "<goal>" --status completed --output "Done"

Create flags:
  --agent-id <id>      Agent identifier (required)
  --type <type>        Action type (required): ${ACTION_TYPES.join(', ')}
  --goal "<text>"      Declared goal (required)
  --agent-name <name>  Agent display name (defaults to agent-id)
  --reasoning "<text>" Reasoning for the action
  --systems "a,b,c"    Comma-separated systems touched
  --risk <0-100>       Risk score
  --confidence <0-100> Confidence score
  --trigger "<text>"   What triggered this action
  --parent <action_id> Parent action ID

Update flags:
  --update <action_id> Action ID to update
  --status <status>    ${ACTION_STATUSES.join(', ')}
  --output "<text>"    Output summary
  --error "<text>"     Error message
  --artifacts "a,b"    Comma-separated artifacts created
  --side-effects "a,b" Comma-separated side effects
  --duration <ms>      Duration in milliseconds

Global flags:
  --local              Use localhost:3000 instead of Vercel
  --dry-run            Print payload without sending
  --json               Machine-readable JSON output`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  loadEnv();
  const args = parseArgs(process.argv);

  // No args → help
  if (!args.update && !args['agent-id']) {
    printUsage();
    process.exit(0);
  }

  const isUpdate = !!args.update;
  const payload = isUpdate ? buildUpdatePayload(args) : buildCreatePayload(args);
  const errors = isUpdate ? validateUpdate(payload) : validateCreate(payload);

  if (errors.length > 0) {
    for (const e of errors) console.error(`Error: ${e}`);
    process.exit(1);
  }

  if (args.dryRun) {
    if (args.json) {
      console.log(JSON.stringify({ mode: isUpdate ? 'update' : 'create', actionId: args.update || null, payload }, null, 2));
    } else {
      console.log(`Mode: ${isUpdate ? 'UPDATE' : 'CREATE'}${isUpdate ? ` (${args.update})` : ''}`);
      console.log('Payload:', JSON.stringify(payload, null, 2));
    }
    return;
  }

  const baseUrl = args.local
    ? 'http://localhost:3000'
    : (process.env.DASHCLAW_BASE_URL || process.env.DASHCLAW_URL || (() => { console.warn('DASHCLAW_BASE_URL not set, falling back to localhost'); return 'http://localhost:3000'; })());
  const apiKey = process.env.DASHCLAW_API_KEY;

  if (!apiKey && !args.local) {
    console.error('Error: DASHCLAW_API_KEY not found (required for production)');
    process.exit(1);
  }

  if (isUpdate) {
    const { status, body } = await updateAction(baseUrl, apiKey, args.update, payload);
    if (status === 200) {
      if (args.json) {
        console.log(JSON.stringify(body));
      } else {
        console.log(`action_id=${args.update}`);
        console.log(`status=${body.action?.status || 'updated'}`);
      }
    } else {
      console.error(`Failed (${status}):`, JSON.stringify(body, null, 2));
      process.exit(1);
    }
  } else {
    const { status, body } = await createAction(baseUrl, apiKey, payload);
    if (status === 201) {
      if (args.json) {
        console.log(JSON.stringify(body));
      } else {
        console.log(`action_id=${body.action_id}`);
      }
    } else {
      console.error(`Failed (${status}):`, JSON.stringify(body, null, 2));
      process.exit(1);
    }
  }
}

main();
