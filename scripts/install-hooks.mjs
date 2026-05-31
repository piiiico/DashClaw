#!/usr/bin/env node
/**
 * install-hooks.mjs — One-command Claude Code hook installer.
 *
 * Copies the three governance hooks (pretool, posttool, stop) plus the
 * vendored `dashclaw_agent_intel` Python module into the project's
 * `.claude/hooks/` directory, then merges the hook entries into
 * `.claude/settings.json` (creating the file if missing).
 *
 * Run from the DashClaw repo root:
 *   node scripts/install-hooks.mjs
 *
 * Or from any project that has DashClaw checked out alongside it by passing
 * --target=<path-to-project-root> (defaults to cwd):
 *   node scripts/install-hooks.mjs --target=/path/to/my-project
 *
 * Idempotent. Safe to re-run after a `git pull` to refresh hooks.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const HOOKS_SRC = join(REPO_ROOT, 'hooks');

function parseArgs(argv) {
  const args = { target: process.cwd() };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--target=')) args.target = resolve(a.slice('--target='.length));
    else if (a === '--target' && i + 1 < argv.length) args.target = resolve(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/install-hooks.mjs [--target=<project-root>]');
      process.exit(0);
    }
  }
  return args;
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function copyTree(srcDir, destDir) {
  ensureDir(destDir);
  for (const entry of readdirSync(srcDir)) {
    if (entry === '__pycache__') continue;
    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);
    if (statSync(srcPath).isDirectory()) {
      copyTree(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

// Hook commands use $CLAUDE_PROJECT_DIR so they resolve correctly regardless
// of what subdirectory an agent has cd'd into. Relative paths like
// `.claude/hooks/dashclaw_pretool.py` break the moment any tool changes cwd
// mid-session, which silently disables every governance hook.
const HOOK_BLOCKS = {
  PreToolUse: [
    {
      matcher: 'Bash|Edit|Write|MultiEdit',
      hooks: [
        {
          type: 'command',
          command: 'python "$CLAUDE_PROJECT_DIR/.claude/hooks/dashclaw_pretool.py"',
          timeout: 3600000,
        },
      ],
    },
  ],
  PostToolUse: [
    {
      matcher: 'Bash|Edit|Write|MultiEdit',
      hooks: [
        {
          type: 'command',
          command: 'python "$CLAUDE_PROJECT_DIR/.claude/hooks/dashclaw_posttool.py"',
        },
      ],
    },
  ],
  Stop: [
    {
      hooks: [
        {
          type: 'command',
          command: 'python "$CLAUDE_PROJECT_DIR/.claude/hooks/dashclaw_stop.py"',
        },
      ],
    },
  ],
};

// Only these exact filenames are considered managed. We match on
// path-separator-bounded occurrences so user-authored wrappers with similar
// names (e.g. `my_dashclaw_pretool.py`, `dashclaw_metrics.py`) are NOT
// silently removed on re-install.
export const MANAGED_HOOK_FILES = ['dashclaw_pretool.py', 'dashclaw_posttool.py', 'dashclaw_stop.py'];
// Full regex-escape (every metacharacter incl. backslash), not just '.', so the
// alternation is always well-formed regardless of the filename contents.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MANAGED_HOOK_RE = new RegExp(
  '(^|[\\\\/])(' + MANAGED_HOOK_FILES.map(escapeRe).join('|') + ')(["\'\\s]|$)'
);

export function isManagedHookCommand(cmd) {
  return MANAGED_HOOK_RE.test(cmd);
}

function mergeSettings(targetRoot) {
  const settingsPath = join(targetRoot, '.claude', 'settings.json');
  let settings = { hooks: {} };
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch (err) {
      console.error(`✗ ${settingsPath} exists but isn't valid JSON: ${err.message}`);
      console.error('  Fix the file by hand or delete it, then re-run.');
      process.exit(1);
    }
  }
  settings.hooks ??= {};

  for (const [event, blocks] of Object.entries(HOOK_BLOCKS)) {
    const existing = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    // Drop any prior dashclaw entries (matcher-by-matcher) so re-running
    // upgrades commands cleanly without duplicating. Matches only our exact
    // managed filenames — user-authored hooks referencing `dashclaw_` elsewhere
    // survive re-install.
    const kept = existing.filter((entry) => {
      const cmds = (entry.hooks || []).map((h) => h.command || '');
      return !cmds.some(isManagedHookCommand);
    });
    settings.hooks[event] = [...kept, ...blocks];
  }

  ensureDir(dirname(settingsPath));
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return settingsPath;
}

function main() {
  const { target } = parseArgs(process.argv);
  const hooksDest = join(target, '.claude', 'hooks');

  console.log(`Source:  ${HOOKS_SRC}`);
  console.log(`Target:  ${hooksDest}`);

  if (!existsSync(HOOKS_SRC)) {
    console.error(`✗ Source hooks dir not found: ${HOOKS_SRC}`);
    process.exit(1);
  }

  ensureDir(hooksDest);

  // Copy the three Python hook scripts.
  for (const name of ['dashclaw_pretool.py', 'dashclaw_posttool.py', 'dashclaw_stop.py']) {
    const src = join(HOOKS_SRC, name);
    if (!existsSync(src)) {
      console.error(`✗ Missing hook script: ${src}`);
      process.exit(1);
    }
    copyFileSync(src, join(hooksDest, name));
    console.log(`✓ ${name}`);
  }

  // Copy the vendored intel module (required by the v2 pretool).
  const intelSrc = join(HOOKS_SRC, 'dashclaw_agent_intel');
  if (existsSync(intelSrc)) {
    copyTree(intelSrc, join(hooksDest, 'dashclaw_agent_intel'));
    console.log('✓ dashclaw_agent_intel/ (intel module)');
  } else {
    console.error(`✗ Missing intel module: ${intelSrc}`);
    process.exit(1);
  }

  // Merge hook entries into .claude/settings.json.
  const settingsPath = mergeSettings(target);
  console.log(`✓ settings merged: ${settingsPath}`);

  console.log('');
  console.log('Done. Restart Claude Code (or open a new session) and ensure');
  console.log('these env vars are set in your shell or .env file:');
  console.log('  DASHCLAW_BASE_URL  (e.g. https://my-dashclaw.vercel.app)');
  console.log('  DASHCLAW_API_KEY   (oc_live_...)');
  console.log('  DASHCLAW_AGENT_ID  (optional, default: claude-code)');
  console.log('  DASHCLAW_HOOK_MODE (optional: enforce | observe, default: enforce)');
}

// Only run main() when executed directly via `node install-hooks.mjs`.
// Guards against accidental execution when the module is imported for testing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
