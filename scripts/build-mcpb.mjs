#!/usr/bin/env node
import { mkdirSync, rmSync, cpSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildMcpbManifest, readMcpServerVersion } from './lib/build-mcpb-manifest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MCP = join(ROOT, 'mcp-server');
const STAGE = join(ROOT, 'dist', 'mcpb-build');
const OUT = join(ROOT, 'dist', 'dashclaw.mcpb');

// Windows uses npm.cmd / npx.cmd; Linux/macOS (Vercel CI) use npm / npx.
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// 1. Fresh staging dir
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

// 2. Copy the publishable server source + lockfile (needed for npm ci)
for (const f of ['bin', 'lib', 'package.json', 'package-lock.json', 'LICENSE', 'README.md']) {
  const src = join(MCP, f);
  if (existsSync(src)) cpSync(src, join(STAGE, f), { recursive: true });
}

// 3. Install production deps into the bundle
execFileSync(npmBin, ['ci', '--omit=dev'], { cwd: STAGE, stdio: 'inherit' });

// 4. Generate manifest.json with the version from package.json (never hardcoded)
const version = readMcpServerVersion();
writeFileSync(
  join(STAGE, 'manifest.json'),
  JSON.stringify(buildMcpbManifest(version), null, 2) + '\n'
);

// 5. Pack the bundle
execFileSync(npxBin, ['--yes', '@anthropic-ai/mcpb@latest', 'pack', STAGE, OUT], {
  cwd: ROOT,
  stdio: 'inherit',
});

console.log(`\nBuilt ${OUT} (v${version})`);
