// cli/test/api.test.js
//
// Tests for cli/lib/api.js apiRequest — the durable direct-API helper used by
// command groups that can't depend on (possibly-stale) published SDK methods.
// global.fetch is stubbed per test and restored afterward.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apiRequest } from '../lib/api.js';

const CONFIG = { baseUrl: 'https://api.example.com', apiKey: 'secret-key' };

function withFetchStub(stub, fn) {
  const original = global.fetch;
  global.fetch = stub;
  return Promise.resolve()
    .then(fn)
    .finally(() => { global.fetch = original; });
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

test('builds the URL with a query string and skips null/undefined values', async () => {
  let calledUrl;
  await withFetchStub(
    async (url) => { calledUrl = url; return jsonResponse({}); },
    () => apiRequest(CONFIG, 'GET', '/api/messages', {
      query: { agent_id: 'agent-1', direction: 'inbox', unread: null, limit: undefined },
    }),
  );
  // Path + only the non-null/undefined params survive.
  assert.equal(
    calledUrl,
    'https://api.example.com/api/messages?agent_id=agent-1&direction=inbox',
  );
});

test('sends the x-api-key header and a JSON-stringified body', async () => {
  let calledInit;
  await withFetchStub(
    async (_url, init) => { calledInit = init; return jsonResponse({}); },
    () => apiRequest(CONFIG, 'PATCH', '/api/messages', {
      body: { message_ids: ['m1', 'm2'], action: 'read', agent_id: 'agent-1' },
    }),
  );
  assert.equal(calledInit.method, 'PATCH');
  assert.equal(calledInit.headers['x-api-key'], 'secret-key');
  assert.equal(calledInit.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calledInit.body), {
    message_ids: ['m1', 'm2'],
    action: 'read',
    agent_id: 'agent-1',
  });
});

test('omits the body when none is provided', async () => {
  let calledInit;
  await withFetchStub(
    async (_url, init) => { calledInit = init; return jsonResponse({ ok: true }); },
    () => apiRequest(CONFIG, 'GET', '/api/prompts/templates'),
  );
  assert.equal(calledInit.body, undefined);
});

test('returns the parsed JSON on an ok response', async () => {
  const payload = { templates: [{ id: 'tpl_1', name: 'Greeting' }] };
  const result = await withFetchStub(
    async () => jsonResponse(payload),
    () => apiRequest(CONFIG, 'GET', '/api/prompts/templates'),
  );
  assert.deepEqual(result, payload);
});

test('throws with the server error message and attaches .status on a non-ok response', async () => {
  await withFetchStub(
    async () => jsonResponse({ error: 'Admin access required' }, { ok: false, status: 403 }),
    async () => {
      await assert.rejects(
        () => apiRequest(CONFIG, 'POST', '/api/prompts/templates', { body: { name: 'x' } }),
        (err) => {
          assert.equal(err.message, 'Admin access required');
          assert.equal(err.status, 403);
          return true;
        },
      );
    },
  );
});

test('falls back to a status message when the error body is not JSON', async () => {
  await withFetchStub(
    async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } }),
    async () => {
      await assert.rejects(
        () => apiRequest(CONFIG, 'GET', '/api/prompts/stats'),
        (err) => {
          assert.equal(err.message, 'Request failed with status 502');
          assert.equal(err.status, 502);
          return true;
        },
      );
    },
  );
});
