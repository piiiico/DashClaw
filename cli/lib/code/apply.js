// `dashclaw code apply <manifestId>` — fetch a write plan from the server
// and apply it locally. The server emits the manifest (Phase 6) with a
// 24h TTL. This module is the only place the CLI writes to disk for the
// Optimal Files feature.

import fs from 'node:fs';
import path from 'node:path';
import { _ensureInsideProject, applyMerge } from './vendored.js';

const SECRET_PATTERNS = [
  { name: 'stripe_test', re: /sk_test_[A-Za-z0-9]{8,}/g },
  { name: 'stripe_live', re: /sk_live_[A-Za-z0-9]{8,}/g },
  { name: 'stripe_webhook', re: /whsec_[A-Za-z0-9]{8,}/g },
  { name: 'openai_key', re: /sk-[A-Za-z0-9]{20,}/g },
  { name: 'anthropic_key', re: /sk-ant-[A-Za-z0-9_\-]{20,}/g },
  { name: 'github_pat', re: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g },
  { name: 'aws_access', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'jwt', re: /eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}/g },
  { name: 'private_key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'env_assign', re: /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|CRED|AUTH))\s*=\s*['"]?[^\s'"\n]+/g },
];

function scanForSecrets(content) {
  let redactions = 0;
  let out = String(content == null ? '' : content);
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p.re, (_match, captured) => {
      redactions++;
      if (p.name === 'env_assign' && captured) return `${captured}=<REDACTED:${p.name}>`;
      return `<REDACTED:${p.name}>`;
    });
  }
  return { status: redactions === 0 ? 'passed' : 'redacted', redactions, redacted: out };
}

async function fetchManifest(baseUrl, apiKey, manifestId, { fetchImpl = fetch }) {
  const url = baseUrl.replace(/\/+$/, '') + '/api/code-sessions/manifests/' + encodeURIComponent(manifestId);
  const res = await fetchImpl(url, {
    headers: { 'x-api-key': apiKey },
  });
  let body = null;
  try { body = await res.json(); } catch { /* null */ }
  return { status: res.status, ok: res.ok, body };
}

export async function runApply({
  baseUrl,
  apiKey,
  manifestId,
  dest,
  yes = false,
  allowRedactions = false,
  allowOverwriteSideBySide = false,
  fetchImpl = fetch,
  logger = console,
}) {
  if (!manifestId) throw new Error('runApply: manifestId is required');
  if (!dest) throw new Error('runApply: --dest=<dir> is required');
  if (!baseUrl || !apiKey) throw new Error('runApply: baseUrl and apiKey are required');

  const destAbs = path.resolve(dest);
  try { fs.mkdirSync(destAbs, { recursive: true }); }
  catch (err) { throw new Error('Could not create destination ' + destAbs + ': ' + err.message); }

  const { status, ok, body } = await fetchManifest(baseUrl, apiKey, manifestId, { fetchImpl });
  if (!ok) throw new Error('Failed to load manifest: HTTP ' + status + (body?.error ? ' — ' + body.error : ''));
  const plan = Array.isArray(body?.plan) ? body.plan : Array.isArray(body?.plan?.results) ? body.plan.results : null;
  if (!plan) throw new Error('Manifest payload missing plan');

  const results = [];
  for (const entry of plan) {
    const target = entry.path;
    if (!target) {
      results.push({ path: '(unknown)', status: 'invalid_entry' });
      continue;
    }
    const abs = _ensureInsideProject(destAbs, target);
    if (!abs) {
      results.push({ path: target, status: 'unsafe_path' });
      logger.warn(`  ${target} -> unsafe_path (refused)`);
      continue;
    }
    const content = entry.content;
    if (typeof content !== 'string') {
      results.push({ path: target, status: 'no_content' });
      continue;
    }
    const scan = scanForSecrets(content);
    if (scan.status === 'redacted' && !allowRedactions) {
      results.push({ path: target, status: 'redacted', redactions: scan.redactions });
      logger.warn(`  ${target} -> ${scan.redactions} secret pattern(s) detected, refused (use --allow-redactions)`);
      continue;
    }
    const mode = entry.mode || 'create';

    try {
      if (mode === 'merge') {
        if (!fs.existsSync(abs)) {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, scan.redacted, 'utf8');
          results.push({ path: target, status: 'created', bytes: Buffer.byteLength(scan.redacted, 'utf8') });
          logger.info(`  ${target} -> created`);
          continue;
        }
        const existing = fs.readFileSync(abs, 'utf8');
        const merged = applyMerge(existing, scan.redacted, {
          acceptedHeadings: entry.acceptedHeadings || [],
          acceptedBullets: entry.acceptedBullets || [],
        });
        fs.writeFileSync(abs, merged.merged, 'utf8');
        results.push({ path: target, status: 'merged', additions: merged.additions });
        logger.info(`  ${target} -> merged`);
      } else if (mode === 'side_by_side') {
        const sideAbs = entry.absolutePath
          ? path.resolve(entry.absolutePath)
          : sideBySidePath(abs);
        const guardedSide = _ensureInsideProject(destAbs, path.relative(destAbs, sideAbs));
        if (!guardedSide) {
          results.push({ path: target, status: 'unsafe_path' });
          continue;
        }
        fs.mkdirSync(path.dirname(guardedSide), { recursive: true });
        if (fs.existsSync(guardedSide) && !allowOverwriteSideBySide) {
          results.push({ path: target, status: 'side_by_side_conflict' });
          logger.warn(`  ${target} -> side_by_side_conflict (pass --overwrite to replace)`);
          continue;
        }
        fs.writeFileSync(guardedSide, scan.redacted, 'utf8');
        results.push({ path: target, status: 'side_by_side', bytes: Buffer.byteLength(scan.redacted, 'utf8') });
        logger.info(`  ${target} -> side_by_side`);
      } else if (mode === 'skip') {
        results.push({ path: target, status: 'skipped' });
      } else {
        // 'create' or 'overwrite'
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const existed = fs.existsSync(abs);
        if (existed && mode !== 'overwrite' && !yes) {
          results.push({ path: target, status: 'refused_overwrite_without_yes' });
          logger.warn(`  ${target} -> exists; pass --yes or rebuild manifest with mode='overwrite'`);
          continue;
        }
        fs.writeFileSync(abs, scan.redacted, 'utf8');
        results.push({ path: target, status: existed ? 'overwritten' : 'created' });
        logger.info(`  ${target} -> ${existed ? 'overwritten' : 'created'}`);
      }
    } catch (err) {
      results.push({ path: target, status: 'error', error: err.message });
      logger.warn(`  ${target} -> error: ${err.message}`);
    }
  }
  return results;
}

function sideBySidePath(abs) {
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  const ext = path.extname(base);
  if (!ext) return path.join(dir, base + '.NEW');
  return path.join(dir, base.slice(0, -ext.length) + '.NEW' + ext);
}

// Exported for the sync script + tests that want to assert the scan layer
// stays in lock-step with app/lib/claude-code/optimal-files/secret-scan.js.
export { scanForSecrets };
