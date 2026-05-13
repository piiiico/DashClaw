// Path B JSONL ingest. Walks `claudeProjectsDir`, posts each .jsonl file to
// /api/code-sessions/ingest-jsonl with source_host='jsonl'. Per A6 in the
// goal, the CLI does NOT parse — the server runs the canonical parser.
//
// Stream-reads files line-by-line so a 30 MB transcript doesn't have to fit
// in memory all at once. Files larger than COMPRESS_THRESHOLD raw are sent
// as gzip+base64 (`compressed_jsonl`) instead of a JSON-array
// (`jsonl_lines`) to fit Vercel's 4.5 MB per-request body limit. Files
// above MAX_FILE_BYTES are still skipped — gzip can't rescue arbitrarily
// large inputs.
//
// Logs per file: { file, posted_lines, status, reason }. NEVER logs raw line
// content — that would leak the user's transcripts through CI logs.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { homedir } from 'node:os';

// Absolute ceiling. Vercel Hobby's 4.5 MB body limit is the binding
// constraint; even at 5× JSONL gzip ratios (typical for highly repetitive
// `role`/`content` keys), 30 MB raw stays under the limit after
// base64-inflation. Files larger than this are skipped with `too_large`.
const MAX_FILE_BYTES = 30 * 1024 * 1024;
// Files larger than this are compressed before POST. Below this size the
// JSON-array path is small enough to fit comfortably and avoids the gzip
// CPU cost for the hot path of small per-session deltas.
const COMPRESS_THRESHOLD = 1 * 1024 * 1024;

export function defaultClaudeProjectsDir(env = process.env) {
  if (env.CLAUDE_PROJECTS_DIR) return env.CLAUDE_PROJECTS_DIR;
  if (process.platform === 'win32') {
    return path.join(env.USERPROFILE || homedir(), '.claude', 'projects');
  }
  return path.join(env.HOME || homedir(), '.claude', 'projects');
}

function listJsonlFiles(rootDir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(rootDir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const p = path.join(rootDir, e.name);
    if (e.isDirectory()) {
      let inner;
      try { inner = fs.readdirSync(p, { withFileTypes: true }); }
      catch { continue; }
      for (const f of inner) {
        if (f.isFile() && f.name.endsWith('.jsonl')) out.push(path.join(p, f.name));
      }
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      out.push(p);
    }
  }
  return out;
}

async function readLines(filePath) {
  const lines = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line) lines.push(line);
  }
  return lines;
}

export async function buildIngestPayload(filePath, { cwdOverride = null } = {}) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) {
    return { tooLarge: true, sizeBytes: stat.size };
  }
  const parent = path.dirname(filePath);
  const slug = path.basename(parent);
  const lines = await readLines(filePath);

  const base = {
    project: {
      slug,
      cwd: cwdOverride,
      source_host: 'jsonl',
    },
    session_uuid: null,
    source_file: filePath,
    source_mtime: stat.mtime.toISOString(),
    tool_use_action_map: {},
  };

  // Compress large files to fit Vercel's per-request body limit. JSONL is
  // highly repetitive (`role`, `content`, `message`, `usage` keys repeat
  // across every record) and compresses ~5× in practice, which is more than
  // enough headroom up to the MAX_FILE_BYTES ceiling.
  let body;
  let compressed = false;
  if (stat.size > COMPRESS_THRESHOLD) {
    const raw = lines.join('\n');
    const gz = zlib.gzipSync(raw);
    body = { ...base, compressed_jsonl: gz.toString('base64') };
    compressed = true;
  } else {
    body = { ...base, jsonl_lines: lines };
  }

  return {
    body,
    sizeBytes: stat.size,
    lineCount: lines.length,
    compressed,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postIngest(baseUrl, apiKey, body, { fetchImpl = fetch, maxRetries = 4 } = {}) {
  const url = baseUrl.replace(/\/+$/, '') + '/api/code-sessions/ingest-jsonl';
  let lastStatus = 0;
  let lastPayload = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });
    let payload = null;
    try { payload = await res.json(); } catch { /* keep payload null */ }
    if (res.ok) return { status: res.status, ok: true, payload };
    lastStatus = res.status;
    lastPayload = payload;
    // Retry on 429 (rate limit) and 5xx with exponential backoff +
    // honour Retry-After when the server provides it. Anything else is
    // surfaced immediately.
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (!retryable || attempt === maxRetries) break;
    const retryAfter = Number(res.headers?.get?.('retry-after')) || 0;
    const backoffMs = retryAfter > 0
      ? Math.min(retryAfter * 1000, 30000)
      : Math.min(1000 * 2 ** attempt, 16000);
    await sleep(backoffMs);
  }
  return { status: lastStatus, ok: false, payload: lastPayload };
}

/**
 * Run the ingest pipeline. Returns a per-file result array. Throws on
 * total config failure; per-file failures are recorded in the result.
 *
 * @param {Object} args
 * @param {string} args.baseUrl
 * @param {string} args.apiKey
 * @param {string} args.projectsDir
 * @param {boolean} [args.dryRun]   When true, builds payloads but skips POST.
 * @param {Function} [args.fetchImpl]
 * @param {Object}   [args.logger]  { info(line), warn(line) }
 */
export async function runIngest({
  baseUrl,
  apiKey,
  projectsDir,
  dryRun = false,
  fetchImpl = fetch,
  logger = console,
}) {
  if (!baseUrl) throw new Error('runIngest: baseUrl is required');
  if (!apiKey && !dryRun) throw new Error('runIngest: apiKey is required for live ingest');

  const files = listJsonlFiles(projectsDir);
  if (!files.length) {
    logger.info(`No .jsonl files found under ${projectsDir}.`);
    return [];
  }

  const results = [];
  for (const file of files) {
    let payload;
    try {
      payload = await buildIngestPayload(file);
    } catch (err) {
      results.push({ file, status: 'error', reason: 'read_failed:' + err.message });
      logger.warn(`  ${file} -> read_failed: ${err.message}`);
      continue;
    }
    if (payload.tooLarge) {
      results.push({ file, status: 'skipped', reason: 'too_large', size_bytes: payload.sizeBytes });
      logger.warn(`  ${file} -> skipped (${payload.sizeBytes} bytes > ${MAX_FILE_BYTES})`);
      continue;
    }
    if (dryRun) {
      results.push({
        file,
        status: 'dry_run',
        reason: 'no_post',
        posted_lines: payload.lineCount,
        size_bytes: payload.sizeBytes,
        slug: payload.body.project.slug,
      });
      logger.info(`  ${file} -> dry_run (${payload.lineCount} lines, slug=${payload.body.project.slug})`);
      continue;
    }
    // Light throttle between live POSTs so a fresh-disk backfill of
    // hundreds of files doesn't hammer Vercel's per-IP rate limit.
    if (results.length > 0) await sleep(150);
    try {
      const { status, ok, payload: respBody } = await postIngest(baseUrl, apiKey, payload.body, { fetchImpl });
      if (!ok) {
        results.push({ file, status: 'error', reason: 'http_' + status, posted_lines: payload.lineCount });
        logger.warn(`  ${file} -> HTTP ${status}`);
        continue;
      }
      const sess = respBody?.session || {};
      results.push({
        file,
        status: sess.skipped ? 'skipped_unchanged' : 'ingested',
        reason: sess.reason || 'ok',
        posted_lines: payload.lineCount,
        session_id: sess.id || null,
      });
      logger.info(`  ${file} -> ${sess.skipped ? 'skipped_unchanged' : 'ingested'} (${payload.lineCount} lines)`);
    } catch (err) {
      results.push({ file, status: 'error', reason: 'network:' + err.message });
      logger.warn(`  ${file} -> network: ${err.message}`);
    }
  }
  return results;
}
