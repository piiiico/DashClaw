/**
 * Disk side-effects for the Optimal Files bundle. CLI-only — the web server
 * MUST NOT import this module.
 *
 * Per the A4 refactor: `applyBundlePlan` and `listGeneratedFiles` live here
 * (the only files in `app/lib/claude-code/` that touch `fs`). They are
 * separated from `bundle.js` so a static dependency check can prove the
 * route layer never accidentally writes to the user's filesystem.
 */

import fs from 'node:fs';
import path from 'node:path';
import { absolutize, sideBySidePath } from './bundle.js';
import { scanForSecrets } from './secret-scan.js';

/**
 * Apply a write plan produced by `planBundleSelections`. Re-runs the secret
 * scan on every file's content at write time. Refuses any path that escapes
 * `projectCwd`.
 *
 * @param {Object} args
 * @param {Array}  args.plan          Result of planBundleSelections: array of
 *                                    `{path, absolutePath, status, content, mode, ...}`.
 * @param {string} args.projectCwd    Project root.
 * @param {boolean} [args.allowOverwriteSideBySide=false]
 *                                    Pass `true` to clobber an existing .NEW file.
 * @param {boolean} [args.allowRedactions=false]
 *                                    Without this flag, files whose secret scan
 *                                    flags redactions are refused with status
 *                                    'redacted'. With it, the redacted content
 *                                    is written.
 * @returns {{ results: Array }}
 */
export function applyBundlePlan({ plan, projectCwd, allowOverwriteSideBySide = false, allowRedactions = false }) {
  if (!projectCwd) {
    return { results: (plan || []).map(p => ({ path: p.path, status: 'project_cwd_missing' })) };
  }
  const results = [];
  for (const entry of plan || []) {
    if (!entry || !entry.path) {
      results.push({ path: '(unknown)', status: 'invalid_entry' });
      continue;
    }
    if (entry.status === 'not_in_bundle' || entry.status === 'unsafe_path' || entry.status === 'project_cwd_missing') {
      results.push({ ...entry });
      continue;
    }
    if (entry.status === 'conflict' || entry.status === 'unknown_existing') {
      results.push({ ...entry, status: 'skipped_conflict' });
      continue;
    }

    const abs = entry.absolutePath || (entry.path ? absolutize(projectCwd, entry.path) : null);
    if (!abs) {
      results.push({ path: entry.path, status: 'unsafe_path' });
      continue;
    }

    let content = entry.content;
    if (typeof content !== 'string') {
      results.push({ path: entry.path, status: 'no_content' });
      continue;
    }

    // Re-run secret scan at write time — defence in depth.
    const scan = scanForSecrets(content);
    if (scan.status === 'redacted' && !allowRedactions) {
      results.push({
        path: entry.path,
        absolutePath: abs,
        status: 'redacted',
        redactions: scan.redactions,
        note: 'Secrets detected at write time; pass allowRedactions=true to write redacted content.',
      });
      continue;
    }
    content = scan.redacted;

    try {
      if (entry.mode === 'merge') {
        // The merge already happened at plan time — `content` is the merged
        // result. Just write it. We deliberately don't re-merge here because
        // the plan was built against a known existingContent snapshot and
        // re-merging with empty acceptedHeadings/Bullets would produce a
        // no-op.
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const existed = fs.existsSync(abs);
        fs.writeFileSync(abs, content, 'utf8');
        results.push({
          path: entry.path,
          absolutePath: abs,
          status: existed ? 'merged' : 'created',
          bytes: Buffer.byteLength(content, 'utf8'),
          additions: entry.additions,
        });
        continue;
      }

      if (entry.mode === 'side_by_side') {
        const sideAbs = entry.absolutePath && entry.absolutePath.endsWith('.NEW')
          ? entry.absolutePath
          : (path.basename(entry.absolutePath || '').includes('.NEW') ? entry.absolutePath : sideBySidePath(abs));
        fs.mkdirSync(path.dirname(sideAbs), { recursive: true });
        if (fs.existsSync(sideAbs) && !allowOverwriteSideBySide) {
          results.push({
            path: entry.path,
            absolutePath: sideAbs,
            status: 'side_by_side_conflict',
            hint: 'A .NEW file already exists. Pass allowOverwriteSideBySide=true to replace it.',
          });
          continue;
        }
        fs.writeFileSync(sideAbs, content, 'utf8');
        results.push({
          path: entry.path,
          absolutePath: sideAbs,
          status: 'side_by_side',
          bytes: Buffer.byteLength(content, 'utf8'),
        });
        continue;
      }

      // 'create' or 'overwrite' — straight write.
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const existed = fs.existsSync(abs);
      fs.writeFileSync(abs, content, 'utf8');
      results.push({
        path: entry.path,
        absolutePath: abs,
        status: existed ? 'overwritten' : 'created',
        bytes: Buffer.byteLength(content, 'utf8'),
      });
    } catch (e) {
      results.push({ path: entry.path, absolutePath: abs, status: 'error', error: e.message });
    }
  }
  return { results };
}

/**
 * Walk the project's `.claude/` tree (only) and return what's already on
 * disk that might conflict with a future bundle write. Safe to call before
 * preview to give the user accurate `overwriteRisk` labels.
 *
 * @param {string} projectCwd
 * @returns {Array<{path: string, bytes: number, modified: string}>}
 */
export function listGeneratedFiles(projectCwd) {
  if (!projectCwd) return [];
  const out = [];
  const candidates = [
    'CLAUDE.md',
    '.claude/dashclaw/session-notes',
    '.claude/dashclaw/recipes',
    // Legacy (pre-rename) locations — still discovered so files written by an
    // older client version remain visible.
    '.claude/agentlens/session-notes',
    '.claude/agentlens/recipes',
    '.claude/rules',
    '.claude/hooks',
    '.claude/skills',
  ];
  for (const rel of candidates) {
    const abs = path.join(projectCwd, rel);
    try {
      const stat = fs.statSync(abs);
      if (stat.isFile()) {
        out.push({ path: rel, bytes: stat.size, modified: stat.mtime.toISOString() });
      } else if (stat.isDirectory()) {
        _walk(abs, projectCwd, out, 0);
      }
    } catch { /* not present — skip */ }
  }
  return out;
}

function _walk(dir, root, out, depth) {
  if (depth > 4) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile()) {
      try {
        const st = fs.statSync(p);
        out.push({ path: path.relative(root, p), bytes: st.size, modified: st.mtime.toISOString() });
      } catch { /* skip */ }
    } else if (e.isDirectory()) {
      _walk(p, root, out, depth + 1);
    }
  }
}
