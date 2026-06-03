#!/usr/bin/env node
/**
 * set-version.mjs <x.y.z> — set the unified DashClaw version across the
 * platform and both SDK manifests at once, so they never drift:
 *   package.json, sdk/package.json, sdk-python/pyproject.toml
 *
 * Usage:
 *   node scripts/set-version.mjs 4.1.0
 *   npm run version:set -- 4.1.0
 *
 * Afterward run `npm install` to sync package-lock.json, then commit.
 * `npm run version:sync:check` (CI + pre-commit) enforces that these agree.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version || '')) {
  console.error('Usage: node scripts/set-version.mjs <x.y.z>   (or: npm run version:set -- <x.y.z>)');
  process.exit(1);
}

function setJsonVersion(rel) {
  const p = resolve(ROOT, rel);
  // Replace only the FIRST `"version": "..."` (the top-level package version).
  const updated = readFileSync(p, 'utf8').replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
  writeFileSync(p, updated);
}

function setPyprojectVersion(rel) {
  const p = resolve(ROOT, rel);
  const updated = readFileSync(p, 'utf8').replace(/^(\s*version\s*=\s*["'])[^"']+(["'])/m, `$1${version}$2`);
  writeFileSync(p, updated);
}

setJsonVersion('package.json');
setJsonVersion('sdk/package.json');
setPyprojectVersion('sdk-python/pyproject.toml');

console.log(`Set DashClaw version to ${version} in:`);
console.log('  package.json, sdk/package.json, sdk-python/pyproject.toml');
console.log('Next: `npm install` to sync package-lock.json, then commit.');
