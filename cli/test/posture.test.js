// cli/test/posture.test.js
//
// Tests for cli/lib/posture.js — the direct-API helpers behind `dashclaw posture`
// / `dashclaw next`. global.fetch is stubbed per test and restored afterward.
// The load-bearing assertion is that resolve is DRAFT-ONLY: it can never send an
// action that activates enforcement.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchPosture, fetchFindings, fetchNext, resolveFinding } from '../lib/posture.js';

const CONFIG = { baseUrl: 'https://api.example.com', apiKey: 'secret-key' };

function withFetchStub(stub, fn) {
  const original = global.fetch;
  global.fetch = stub;
  return Promise.resolve().then(fn).finally(() => { global.fetch = original; });
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

test('fetchPosture GETs /api/posture', async () => {
  let url, init;
  await withFetchStub(async (u, i) => { url = u; init = i; return jsonResponse({ score: 72 }); }, async () => {
    const data = await fetchPosture(CONFIG);
    assert.equal(data.score, 72);
  });
  assert.equal(url, 'https://api.example.com/api/posture');
  assert.equal(init.method, 'GET');
  assert.equal(init.headers['x-api-key'], 'secret-key');
});

test('fetchFindings forwards status/dimension as a query string', async () => {
  let url;
  await withFetchStub(async (u) => { url = u; return jsonResponse({ findings: [] }); }, async () => {
    await fetchFindings(CONFIG, { status: 'snoozed', dimension: 'spend' });
  });
  assert.ok(url.includes('status=snoozed'));
  assert.ok(url.includes('dimension=spend'));
});

test('fetchNext returns the first finding, or null when the queue is clear', async () => {
  await withFetchStub(async () => jsonResponse({ findings: [{ key: 'a' }, { key: 'b' }] }), async () => {
    const f = await fetchNext(CONFIG);
    assert.equal(f.key, 'a');
  });
  await withFetchStub(async () => jsonResponse({ findings: [] }), async () => {
    assert.equal(await fetchNext(CONFIG), null);
  });
});

test('resolveFinding defaults to create_draft and POSTs to the resolve route', async () => {
  let url, init;
  await withFetchStub(async (u, i) => { url = u; init = i; return jsonResponse({ resolved: true }); }, async () => {
    await resolveFinding(CONFIG, 'find/key+x', undefined, 'later');
  });
  assert.equal(url, 'https://api.example.com/api/posture/findings/find%2Fkey%2Bx/resolve');
  assert.equal(init.method, 'POST');
  assert.deepEqual(JSON.parse(init.body), { action: 'create_draft', note: 'later' });
});

test('resolveFinding accepts snooze + accept_risk', async () => {
  for (const action of ['snooze', 'accept_risk']) {
    let init;
    await withFetchStub(async (_u, i) => { init = i; return jsonResponse({ resolved: true }); }, async () => {
      await resolveFinding(CONFIG, 'k', action);
    });
    assert.equal(JSON.parse(init.body).action, action);
  }
});

test('resolveFinding REJECTS any non-draft-only action (cannot activate enforcement)', async () => {
  let fetched = false;
  await withFetchStub(async () => { fetched = true; return jsonResponse({}); }, async () => {
    await assert.rejects(() => resolveFinding(CONFIG, 'k', 'activate'), /Draft-only/);
  });
  assert.equal(fetched, false, 'must not hit the network for an invalid action');
});
