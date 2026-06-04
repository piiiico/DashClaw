#!/usr/bin/env node
/**
 * report-tokens.mjs — Parse Claude Code /status output and POST to DashClaw /api/tokens
 *
 * Usage:
 *   node scripts/report-tokens.mjs --agent-id my-agent --status "Tokens: 10 in / 885 out ..."
 *   node scripts/report-tokens.mjs --agent-id my-agent --context-used 87000 --context-max 200000 --hourly-left 72
 *   node scripts/report-tokens.mjs --agent-id my-agent --status "..." --local
 *
 * Loads DASHCLAW_API_KEY from .env.local (same dir convention as _run-with-env.mjs).
 * Defaults to Vercel production URL; use --local for http://localhost:3000.
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
    } else if (arg.startsWith('--') && i + 1 < argv.length) {
      const key = arg.slice(2);
      args[key] = argv[++i];
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Parse /status text (regex patterns from clawd-tools/tools/token-capture/capture.py)
// ---------------------------------------------------------------------------
function parseStatus(text) {
  const data = {};

  // Tokens: 10 in / 885 out
  const tokensMatch = text.match(/Tokens:\s*(\d[\d,]*)\s*in\s*\/\s*(\d[\d,]*)\s*out/i);
  if (tokensMatch) {
    data.tokens_in = parseInt(tokensMatch[1].replace(/,/g, ''), 10);
    data.tokens_out = parseInt(tokensMatch[2].replace(/,/g, ''), 10);
  }

  // Context: 87k/200k (44%)
  const contextMatch = text.match(/Context:\s*(\d+)k\/(\d+)k\s*\((\d+)%\)/i);
  if (contextMatch) {
    data.context_used = parseInt(contextMatch[1], 10) * 1000;
    data.context_max = parseInt(contextMatch[2], 10) * 1000;
  }

  // Usage: 5h 72% left ... Week 18% left
  const usageMatch = text.match(/(\d+)%\s*left.*?Week\s*(\d+)%\s*left/i);
  if (usageMatch) {
    data.hourly_pct_left = parseFloat(usageMatch[1]);
    data.weekly_pct_left = parseFloat(usageMatch[2]);
  }

  // Compactions: 4
  const compactMatch = text.match(/Compactions:\s*(\d+)/i);
  if (compactMatch) {
    data.compactions = parseInt(compactMatch[1], 10);
  }

  // Model: anthropic/claude-opus-4-5  or  Model: claude-opus-4-6
  const modelMatch = text.match(/Model:\s*(\S+)/i);
  if (modelMatch) {
    data.model = modelMatch[1];
  }

  // Session: agent:main:main
  const sessionMatch = text.match(/Session:\s*(\S+)/i);
  if (sessionMatch) {
    data.session_key = sessionMatch[1];
  }

  return data;
}

// ---------------------------------------------------------------------------
// Build payload from parsed status + explicit CLI overrides
// ---------------------------------------------------------------------------
function buildPayload(args, parsed) {
  const payload = {
    agent_id: args['agent-id'] || 'unknown',
    tokens_in: parseInt(args['tokens-in'] || parsed.tokens_in || 0, 10),
    tokens_out: parseInt(args['tokens-out'] || parsed.tokens_out || 0, 10),
    context_used: parseInt(args['context-used'] || parsed.context_used || 0, 10),
    context_max: parseInt(args['context-max'] || parsed.context_max || 200000, 10),
    model: args['model'] || parsed.model || 'unknown',
    session_key: args['session-key'] || parsed.session_key || args['agent-id'] || 'cli',
    hourly_pct_left: parseFloat(args['hourly-left'] ?? parsed.hourly_pct_left ?? 100),
    weekly_pct_left: parseFloat(args['weekly-left'] ?? parsed.weekly_pct_left ?? 100),
    compactions: parseInt(args['compactions'] ?? parsed.compactions ?? 0, 10),
  };
  return payload;
}

// ---------------------------------------------------------------------------
// POST to /api/tokens
// ---------------------------------------------------------------------------
async function postTokens(baseUrl, apiKey, payload) {
  const url = `${baseUrl}/api/tokens`;
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  loadEnv();
  const args = parseArgs(process.argv);

  if (!args['agent-id'] && !args.status) {
    console.log(`Usage:
  node scripts/report-tokens.mjs --agent-id <id> --status "<paste /status output>"
  node scripts/report-tokens.mjs --agent-id <id> --tokens-in 10 --tokens-out 885 --context-used 87000

Options:
  --agent-id <id>        Agent identifier (e.g. my-agent)
  --status "<text>"      Raw /status output to parse
  --tokens-in <n>        Explicit input tokens
  --tokens-out <n>       Explicit output tokens
  --context-used <n>     Context window tokens used
  --context-max <n>      Context window max (default 200000)
  --hourly-left <n>      Hourly rate limit % remaining
  --weekly-left <n>      Weekly rate limit % remaining
  --compactions <n>      Number of context compactions
  --model <name>         Model name
  --session-key <key>    Session identifier
  --local                POST to localhost:3000 instead of Vercel
  --dry-run              Parse and print payload without POSTing`);
    process.exit(0);
  }

  // Parse /status text if provided
  const parsed = args.status ? parseStatus(args.status) : {};
  const payload = buildPayload(args, parsed);

  // Validate we have something to report
  if (payload.tokens_in === 0 && payload.tokens_out === 0 && payload.context_used === 0) {
    console.error('Error: No token data found. Provide --status text or explicit values.');
    process.exit(1);
  }

  console.log('Payload:', JSON.stringify(payload, null, 2));

  if (args.dryRun) {
    console.log('(dry run — not sending)');
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

  console.log(`POSTing to ${baseUrl}/api/tokens ...`);
  const { status, body } = await postTokens(baseUrl, apiKey, payload);

  if (status === 201) {
    console.log(`Success (${status}): snapshot recorded for ${payload.agent_id}`);
  } else {
    console.error(`Failed (${status}):`, JSON.stringify(body, null, 2));
    process.exit(1);
  }
}

main();
