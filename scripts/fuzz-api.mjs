#!/usr/bin/env node
/**
 * Schemathesis fuzz harness for the DashClaw critical-stable API surface.
 *
 * Property-based fuzz testing: schemathesis reads `docs/openapi/critical-stable.openapi.json`
 * and auto-generates thousands of requests (valid, edge-case, and adversarial) against
 * every endpoint, asserting:
 *   - no 500 (unhandled exception)
 *   - response status matches declared options
 *   - response body matches declared schema
 *   - content-type matches spec
 *   - required headers present
 *   - negative data rejected / positive data accepted
 *
 * Requires the `st` / `schemathesis` CLI on PATH. Install once:
 *   pipx install schemathesis
 *
 * Usage:
 *   # Point at local dev (default)
 *   npm run test:fuzz
 *
 *   # Point at staging / prod with a specific API key
 *   DASHCLAW_BASE_URL=https://stage.example.com DASHCLAW_API_KEY=oc_live_xxx npm run test:fuzz
 *
 *   # Pass extra flags through to schemathesis
 *   npm run test:fuzz -- --max-examples 200 --workers 4
 *
 * Reports land in `.fuzz-report/` (gitignored). Exit code is schemathesis's —
 * non-zero means at least one operation failed a check.
 */
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();
const SPEC_PATH = resolve(REPO_ROOT, 'docs', 'openapi', 'critical-stable.openapi.json');
const REPORT_DIR = resolve(REPO_ROOT, '.fuzz-report');

// Load .env.local so API_KEY works without manual export (matches test-full-api.mjs pattern)
try {
  const lines = readFileSync(resolve(REPO_ROOT, '.env.local'), 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx > 0 && !line.startsWith('#')) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  }
} catch {
  // no .env.local — explicit env vars only
}

const BASE_URL = process.env.DASHCLAW_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.DASHCLAW_API_KEY || '';

if (!existsSync(SPEC_PATH)) {
  console.error(`OpenAPI spec not found: ${SPEC_PATH}`);
  console.error('Run `npm run openapi:generate` first.');
  process.exit(1);
}

if (!API_KEY) {
  console.warn('[fuzz] DASHCLAW_API_KEY not set — every request will return 401.');
  console.warn('[fuzz] Set it in .env.local or the environment, then retry.');
  process.exit(1);
}

mkdirSync(REPORT_DIR, { recursive: true });

// Note: header value is `NAME:VALUE` with NO space after the colon. A space
// here breaks argument parsing when spawn goes through a shell on Windows.
//
// Default checks are narrowed to the three highest-value ones:
//   - not_a_server_error:           catches 500s (real crashes)
//   - response_schema_conformance:  catches schemas that disagree with code
//   - content_type_conformance:     catches HTML-when-JSON-expected, etc.
//
// The noisier checks (missing_required_header, status_code_conformance) flag
// Next.js's default 404-for-unknown-path behavior as a mismatch, which drowns
// real findings. Enable them with `npm run test:fuzz -- --checks all`.
const defaultArgs = [
  'run',
  SPEC_PATH,
  '--url', BASE_URL,
  '--header', `x-api-key:${API_KEY}`,
  '--checks', 'not_a_server_error,response_schema_conformance,content_type_conformance',
  '--max-examples', '30',
  '--workers', '2',
  '--request-timeout', '10',
  '--rate-limit', '50/s',
  '--report', 'ndjson,junit',
  '--report-dir', REPORT_DIR,
  '--output-sanitize', 'true',
];

// Pass through any extra args after `--` to schemathesis
const passthrough = process.argv.slice(2);
const args = [...defaultArgs, ...passthrough];

console.log(`[fuzz] base-url: ${BASE_URL}`);
console.log(`[fuzz] spec:     ${SPEC_PATH}`);
console.log(`[fuzz] reports:  ${REPORT_DIR}`);
// Redact any arg carrying the API key to a constant so the secret value never
// reaches the log — full-arg replacement leaves no tainted substring behind.
const displayArgs = args.map((a) => (API_KEY && a.includes(API_KEY) ? '<api-key-arg-redacted>' : a));
console.log(`[fuzz] running:  st ${displayArgs.join(' ')}\n`);

// Spawn without shell: on Windows, shell:true routes through cmd.exe which
// mangles the colon in header values even when the value is a single arg.
// Force UTF-8 for Python I/O so schemathesis's box-drawing header characters
// don't crash on Windows default cp1252 console encoding.
const isWindows = process.platform === 'win32';
const cmd = isWindows ? 'st.exe' : 'st';
const child = spawn(cmd, args, {
  stdio: 'inherit',
  env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
});

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error('\n[fuzz] schemathesis CLI (`st`) not found on PATH.');
    console.error('[fuzz] Install once: pipx install schemathesis');
    process.exit(2);
  }
  console.error('[fuzz] spawn error:', err);
  process.exit(2);
});

child.on('exit', (code) => {
  console.log(`\n[fuzz] schemathesis exited with code ${code}`);
  console.log(`[fuzz] Review NDJSON events: ${resolve(REPORT_DIR, 'events.ndjson')}`);
  console.log(`[fuzz] Review JUnit XML:     ${resolve(REPORT_DIR, 'junit.xml')}`);
  process.exit(code ?? 1);
});
