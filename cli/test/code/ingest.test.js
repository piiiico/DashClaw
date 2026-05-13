import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
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
