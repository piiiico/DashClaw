// Path B JSONL ingest. Walks `claudeProjectsDir`, posts each .jsonl file to
// /api/code-sessions/ingest-jsonl with source_host='jsonl'. Per A6 in the
// goal, the CLI does NOT parse — the server runs the canonical parser.
//
// Stream-reads files line-by-line so a large transcript doesn't have to fit
// in memory all at once. The body always carries raw `jsonl_lines`; when the
// serialized request exceeds GZIP_WIRE_THRESHOLD, postIngest gzips the whole
// envelope on the wire (raw gzip via the `x-dashclaw-encoding: gzip` header,
// no base64 inflation) to fit Vercel's 4.5 MB per-request body limit. Files
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

// Absolute ceiling. Vercel Hobby's 4.5 MB body limit is the binding constraint,
// but the wire body is now raw gzip (not base64), which compresses our JSONL
// ~4-5×. A 40 MB raw file gzips to ~8 MB, still over the cap — so 40 MB is the
// point past which even gzip can't fit a single request. Files larger are
// skipped with `too_large` (a future change can line-chunk them; none observed
// in the wild yet — largest seen is 19 MB raw → 3.3 MB gzipped).
const MAX_FILE_BYTES = 40 * 1024 * 1024;
// Serialized-JSON byte size above which postIngest gzips the request body
// (custom `x-dashclaw-encoding: gzip` transport). Below this the plain JSON body
// fits comfortably and we skip the gzip CPU cost for the hot path of small
// per-session deltas. Set well under Vercel's 4.5 MB cap so the *plain* path is
// only ever used for bodies that are already safe.
const GZIP_WIRE_THRESHOLD = 3 * 1024 * 1024;

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

  // Always build the logical body with raw `jsonl_lines`. Wire compression is
  // decided in postIngest (gzip the whole envelope when it's large) rather than
  // here — keeping payload construction independent of transport means the same
  // body serializes identically whether or not it ends up gzipped.
  const body = {
    project: {
      slug,
      cwd: cwdOverride,
      source_host: 'jsonl',
    },
    session_uuid: null,
    source_file: filePath,
    source_mtime: stat.mtime.toISOString(),
    tool_use_action_map: {},
    jsonl_lines: lines,
  };

  return {
    body,
    sizeBytes: stat.size,
    lineCount: lines.length,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postIngest(baseUrl, apiKey, body, { fetchImpl = fetch, maxRetries = 4 } = {}) {
  const url = baseUrl.replace(/\/+$/, '') + '/api/code-sessions/ingest-jsonl';
  // Decide transport once, outside the retry loop: gzip the JSON envelope when
  // it's large. The custom `x-dashclaw-encoding: gzip` header tells the server
  // to inflate before parsing. Raw gzip (not base64) keeps the wire body under
  // Vercel's 4.5 MB cap for the big sessions that previously 413'd.
  const json = JSON.stringify(body);
  const useGzip = Buffer.byteLength(json, 'utf8') > GZIP_WIRE_THRESHOLD;
  const requestBody = useGzip ? zlib.gzipSync(json) : json;
  const headers = { 'content-type': 'application/json', 'x-api-key': apiKey };
  if (useGzip) headers['x-dashclaw-encoding'] = 'gzip';
  let lastStatus = 0;
  let lastPayload = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: requestBody,
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
