#!/usr/bin/env node
/**
 * check-version-sync.mjs — enforce ONE DashClaw version.
 *
 * As of 4.0.0 the platform and both SDKs share a single version. These three
 * manifests must always agree:
 *   package.json              (platform / Next.js app)
 *   sdk/package.json          (npm SDK)
 *   sdk-python/pyproject.toml (PyPI SDK)
 *
 * Bump all three together with `npm run version:set <x.y.z>`. CI and the
 * pre-commit hook run this guard, so drift fails the build.
 *
 * (The `dashclaw` plugin bundle and CLI keep their own manifest versions and
 * are intentionally NOT part of this check.)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function jsonVersion(rel) {
  return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8')).version;
}

function pyprojectVersion(rel) {
  const m = readFileSync(resolve(ROOT, rel), 'utf8').match(/^\s*version\s*=\s*["']([^"']+)["']/m);
  return m ? m[1] : null;
}

const versions = {
  'package.json': jsonVersion('package.json'),
  'sdk/package.json': jsonVersion('sdk/package.json'),
  'sdk-python/pyproject.toml': pyprojectVersion('sdk-python/pyproject.toml'),
};

const unique = [...new Set(Object.values(versions))];

if (unique.length === 1 && unique[0]) {
  console.log(`OK platform + SDK versions are in sync: ${unique[0]}`);
  process.exit(0);
}

console.error('FAIL platform and SDK versions are out of sync:');
for (const [file, v] of Object.entries(versions)) console.error(`  ${file}: ${v ?? '(unparseable)'}`);
console.error('\nThe platform and both SDKs must share one version. Bump them together with `npm run version:set <x.y.z>`.');
process.exit(1);
