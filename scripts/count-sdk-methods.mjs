#!/usr/bin/env node
/**
 * count-sdk-methods.mjs — reproducible public-method counts for the canonical
 * SDK surfaces, so docs cite a defensible number instead of drifting.
 *
 * Counting rule (both languages): public instance methods declared in the
 * class body of the exported `DashClaw` client — EXCLUDING the constructor and
 * any name starting with `_` (private). Nested namespaces (e.g. the
 * constructor-bound `execution.capabilities` delegates), module-level
 * functions, framework-integration modules, and the error classes are NOT
 * counted.
 *
 *   Node:   `class DashClaw { … }`  in  sdk/dashclaw.js
 *   Python: `class DashClaw:`       in  sdk-python/dashclaw/client.py
 *
 * Usage:
 *   node scripts/count-sdk-methods.mjs              # print counts
 *   node scripts/count-sdk-methods.mjs --check N P  # exit 1 unless Node==N, Python==P
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Return the lines of the `DashClaw` class body. `DashClaw` is the last class
 * in both files, so Node runs to EOF; Python stops at the next column-0
 * `class `/`def ` (or EOF).
 */
function dashClawClassBody(text, lang) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^class DashClaw\b/.test(l));
  if (start === -1) throw new Error('`class DashClaw` not found');
  let end = lines.length;
  if (lang === 'py') {
    for (let i = start + 1; i < lines.length; i++) {
      if (/^(class |def |[A-Za-z])/.test(lines[i])) { end = i; break; }
    }
  }
  return lines.slice(start + 1, end);
}

function countNode() {
  const text = readFileSync(resolve(ROOT, 'sdk/dashclaw.js'), 'utf8');
  // Class-method shorthand at 2-space indent: `name(`, `async name(`,
  // `static name(`, `*name(`. Deduped by name.
  const re = /^ {2}(?:static\s+)?(?:async\s+|\*\s*)?([A-Za-z][A-Za-z0-9_]*)\s*\(/;
  const seen = new Set();
  for (const line of dashClawClassBody(text, 'js')) {
    const m = re.exec(line);
    if (!m) continue;
    const name = m[1];
    if (name === 'constructor' || name.startsWith('_')) continue;
    seen.add(name);
  }
  return seen;
}

function countPython() {
  const text = readFileSync(resolve(ROOT, 'sdk-python/dashclaw/client.py'), 'utf8');
  const re = /^ {4}(?:async\s+)?def\s+([A-Za-z][A-Za-z0-9_]*)\s*\(/;
  const seen = new Set();
  for (const line of dashClawClassBody(text, 'py')) {
    const m = re.exec(line);
    if (!m) continue;
    const name = m[1];
    if (name.startsWith('_')) continue;
    seen.add(name);
  }
  return seen;
}

const node = countNode();
const python = countPython();

console.log(`Node   (sdk/dashclaw.js):               ${node.size} public methods`);
console.log(`Python (sdk-python/dashclaw/client.py): ${python.size} public methods`);

const args = process.argv.slice(2);
if (args[0] === '--check') {
  const wantNode = parseInt(args[1], 10);
  const wantPy = parseInt(args[2], 10);
  let bad = false;
  if (node.size !== wantNode) { console.error(`FAIL Node: expected ${wantNode}, got ${node.size}`); bad = true; }
  if (python.size !== wantPy) { console.error(`FAIL Python: expected ${wantPy}, got ${python.size}`); bad = true; }
  if (bad) {
    console.error('\nUpdate the cited counts in README.md / PROJECT_DETAILS.md, or pass the new numbers.');
    process.exit(1);
  }
  console.log('OK counts match.');
}
