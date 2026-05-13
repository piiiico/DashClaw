import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMemo } from '../../lib/code/memo.js';

function startStubServer(handler) {
  const server = http.createServer((req, res) => {
    const reply = handler({ url: req.url, method: req.method, headers: req.headers });
    res.writeHead(reply.status || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply.body || {}));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

const silentLogger = { info() {}, warn() {} };

describe('cli code memo', () => {
  it('prints the most recent memo when one exists', async () => {
    const { server, baseUrl } = await startStubServer(() => ({
      status: 200,
      body: {
        memos: [
          { iso_week_tag: '2026-W19', body_md: '# old memo' },
          { iso_week_tag: '2026-W20', body_md: '# new memo' },
        ],
      },
    }));
    try {
      const result = await runMemo({
        baseUrl,
        apiKey: 'k',
        project: 'demo',
        fetchImpl: fetch,
        logger: silentLogger,
      });
      assert.equal(result.memo.iso_week_tag, '2026-W20');
      assert.equal(result.saved, false);
    } finally {
      server.close();
    }
  });

  it('saves to ./memos when --save is requested', async () => {
    const { server, baseUrl } = await startStubServer(() => ({
      status: 200,
      body: {
        memos: [{ iso_week_tag: '2026-W20', body_md: '# memo content' }],
      },
    }));
    const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dashclaw-cli-memo-'));
    const origCwd = process.cwd();
    process.chdir(tmpCwd);
    try {
      const result = await runMemo({
        baseUrl,
        apiKey: 'k',
        project: 'demo-project',
        save: true,
        fetchImpl: fetch,
        logger: silentLogger,
      });
      assert.equal(result.saved, true);
      assert.ok(fs.existsSync(result.filePath));
      const content = fs.readFileSync(result.filePath, 'utf8');
      assert.match(content, /memo content/);
    } finally {
      process.chdir(origCwd);
      server.close();
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    }
  });

  it('reports "no memos" without throwing when the server returns an empty list', async () => {
    const { server, baseUrl } = await startStubServer(() => ({
      status: 200,
      body: { memos: [] },
    }));
    try {
      const result = await runMemo({
        baseUrl,
        apiKey: 'k',
        project: 'demo',
        fetchImpl: fetch,
        logger: silentLogger,
      });
      assert.equal(result.memo, null);
    } finally {
      server.close();
    }
  });

  it('throws with HTTP code on server error', async () => {
    const { server, baseUrl } = await startStubServer(() => ({
      status: 503,
      body: { error: 'unavailable' },
    }));
    try {
      await assert.rejects(() =>
        runMemo({ baseUrl, apiKey: 'k', project: 'demo', fetchImpl: fetch, logger: silentLogger }),
        /HTTP 503/);
    } finally {
      server.close();
    }
  });
});
