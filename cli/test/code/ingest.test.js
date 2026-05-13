import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { runIngest, buildIngestPayload, defaultClaudeProjectsDir } from '../../lib/code/ingest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'claude-projects');

function startStubServer(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* keep null */ }
      const reply = handler({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsed,
      });
      res.writeHead(reply.status || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body || {}));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

const silentLogger = { info() {}, warn() {} };

describe('cli code ingest — defaults', () => {
  it('defaultClaudeProjectsDir honours CLAUDE_PROJECTS_DIR env override', () => {
    const dir = defaultClaudeProjectsDir({ CLAUDE_PROJECTS_DIR: '/explicit/path' });
    assert.equal(dir, '/explicit/path');
  });

  it('defaultClaudeProjectsDir falls back to USERPROFILE on win32', () => {
    const dir = defaultClaudeProjectsDir({ USERPROFILE: 'C:/Users/x' });
    // On non-win32 platforms this returns $HOME/.claude/projects; on win32 it
    // returns USERPROFILE/.claude/projects. Either way the path ends in
    // .claude/projects (or .claude\projects on win32), which is the contract
    // tested here.
    assert.ok(dir.replace(/\\/g, '/').endsWith('.claude/projects'),
      `expected ${dir} to end with .claude/projects`);
  });
});

describe('cli code ingest — buildIngestPayload', () => {
  it('derives slug from parent directory basename and uses ISO mtime', async () => {
    const file = path.join(FIXTURES, 'demo-frontend', 'session-aaa.jsonl');
    const payload = await buildIngestPayload(file);
    assert.equal(payload.body.project.slug, 'demo-frontend');
    assert.equal(payload.body.project.source_host, 'jsonl');
    assert.equal(payload.body.session_uuid, null);
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(payload.body.source_mtime), 'source_mtime should be ISO');
    assert.equal(typeof payload.body.jsonl_lines[0], 'string');
    assert.ok(payload.body.jsonl_lines.length >= 1);
    assert.deepEqual(payload.body.tool_use_action_map, {});
    assert.equal(payload.compressed, false);
  });

  it('switches to compressed_jsonl (gzip+base64) for files over the threshold and round-trips', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashclaw-ingest-test-'));
    const projectDir = path.join(tmpDir, 'big-project');
    fs.mkdirSync(projectDir);
    const file = path.join(projectDir, 'session-big.jsonl');
    try {
      // Synthesize >1 MB of valid JSONL lines. Each line is ~150 bytes; ~10k
      // lines comfortably crosses the COMPRESS_THRESHOLD without taking long
      // to write or compress.
      const lines = [];
      for (let i = 0; i < 10000; i++) {
        lines.push(JSON.stringify({
          type: 'user',
          uuid: `u-${i}`,
          timestamp: '2026-05-13T12:00:00Z',
          message: { role: 'user', content: `line ${i} padding xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` },
        }));
      }
      fs.writeFileSync(file, lines.join('\n'), 'utf8');
      const stat = fs.statSync(file);
      assert.ok(stat.size > 1024 * 1024, `expected file > 1 MB, got ${stat.size}`);

      const payload = await buildIngestPayload(file);

      assert.equal(payload.compressed, true);
      assert.equal(payload.body.project.slug, 'big-project');
      assert.equal(payload.body.jsonl_lines, undefined, 'jsonl_lines should not be set on compressed path');
      assert.equal(typeof payload.body.compressed_jsonl, 'string');
      // Sanity: base64-encoded gzip of repetitive JSONL is dramatically
      // smaller than the raw file.
      assert.ok(payload.body.compressed_jsonl.length < stat.size,
        `compressed payload (${payload.body.compressed_jsonl.length}) should be < raw size (${stat.size})`);

      // Round-trip: decompress and verify we get the original lines back.
      const decoded = zlib.gunzipSync(Buffer.from(payload.body.compressed_jsonl, 'base64')).toString('utf8');
      const roundTripped = decoded.split('\n').filter(l => l.length > 0);
      assert.equal(roundTripped.length, lines.length);
      assert.equal(roundTripped[0], lines[0]);
      assert.equal(roundTripped[roundTripped.length - 1], lines[lines.length - 1]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('cli code ingest — runIngest', () => {
  it('dry-run produces a per-file report without hitting the network', async () => {
    const results = await runIngest({
      baseUrl: 'http://does-not-exist.invalid',
      apiKey: 'unused',
      projectsDir: FIXTURES,
      dryRun: true,
      fetchImpl: () => { throw new Error('fetch should not be called in dry-run'); },
      logger: silentLogger,
    });
    assert.ok(results.length >= 3, `expected >=3 results, got ${results.length}`);
    const slugs = new Set(results.map(r => r.slug));
    assert.ok(slugs.has('demo-frontend'));
    assert.ok(slugs.has('demo-api'));
    for (const r of results) {
      assert.equal(r.status, 'dry_run');
      assert.ok(r.posted_lines > 0);
    }
  });

  it('live mode POSTs each file with the expected payload shape', async () => {
    const calls = [];
    const { server, baseUrl } = await startStubServer(({ url, headers, body }) => {
      calls.push({ url, key: headers['x-api-key'], body });
      return {
        status: 200,
        body: {
          project: { id: 'cp_stub', slug: body.project.slug },
          session: { id: 'cs_stub', skipped: false, reason: 'created' },
        },
      };
    });
    try {
      const results = await runIngest({
        baseUrl,
        apiKey: 'k-test',
        projectsDir: FIXTURES,
        fetchImpl: fetch,
        logger: silentLogger,
      });
      assert.equal(calls.length, results.length);
      for (const c of calls) {
        assert.equal(c.url, '/api/code-sessions/ingest-jsonl');
        assert.equal(c.key, 'k-test');
        assert.equal(c.body.project.source_host, 'jsonl');
        assert.ok(c.body.source_file);
        assert.ok(Array.isArray(c.body.jsonl_lines));
        assert.ok(c.body.jsonl_lines.every(ln => typeof ln === 'string'));
      }
      for (const r of results) assert.equal(r.status, 'ingested');
    } finally {
      server.close();
    }
  });

  it('passes the skipped_unchanged reason through from the server', async () => {
    const { server, baseUrl } = await startStubServer(({ body }) => ({
      status: 200,
      body: {
        project: { id: 'cp_stub', slug: body.project.slug },
        session: { id: 'cs_stub', skipped: true, reason: 'unchanged' },
      },
    }));
    try {
      const results = await runIngest({
        baseUrl,
        apiKey: 'k-test',
        projectsDir: FIXTURES,
        fetchImpl: fetch,
        logger: silentLogger,
      });
      for (const r of results) {
        assert.equal(r.status, 'skipped_unchanged');
        assert.equal(r.reason, 'unchanged');
      }
    } finally {
      server.close();
    }
  });

  it('surfaces HTTP errors as per-file error records, not a thrown exception', async () => {
    const { server, baseUrl } = await startStubServer(() => ({
      status: 500,
      body: { error: 'boom' },
    }));
    try {
      const results = await runIngest({
        baseUrl,
        apiKey: 'k-test',
        projectsDir: FIXTURES,
        fetchImpl: fetch,
        logger: silentLogger,
      });
      assert.ok(results.length >= 1);
      for (const r of results) {
        assert.equal(r.status, 'error');
        assert.equal(r.reason, 'http_500');
      }
    } finally {
      server.close();
    }
  });

  it('returns empty results without throwing when projectsDir does not exist', async () => {
    const results = await runIngest({
      baseUrl: 'http://stub.invalid',
      apiKey: 'k',
      projectsDir: path.join(FIXTURES, 'nope-does-not-exist'),
      fetchImpl: () => { throw new Error('should not be called'); },
      logger: silentLogger,
    });
    assert.deepEqual(results, []);
  });
});
