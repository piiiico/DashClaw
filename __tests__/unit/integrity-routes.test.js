import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../helpers.js';
import { generateSigningKey } from '../../app/lib/integrity/keys.js';
import { issueReceipt } from '../../app/lib/integrity/receipt.js';
import { verify } from '../../app/lib/integrity/verify.js';
import { signBundle } from '../../app/lib/integrity/bundle.js';

const KEY = generateSigningKey('route-test-kid');

const { mockSql } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
}));
vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/integrity/server-key.js', () => ({
  getServerPublicJwks: vi.fn(async () => ({ keys: [KEY.publicKeyJwk] })),
}));

import { GET as JwksGET } from '@/api/integrity/jwks/route.js';
import { POST as VerifyPOST } from '@/api/integrity/verify/route.js';

const SOURCE = {
  requiredFacts: [{ label: 'a', value: 'x' }],
  allowedFacts: [{ label: 'a', value: 'x' }],
  extract: { money: false, dates: false, percentages: false },
};

function makeReceipt() {
  return issueReceipt(verify('x', SOURCE), 'x', SOURCE, { kid: KEY.kid, privateKeyJwk: KEY.privateKeyJwk }, '2026-06-01T00:00:00.000Z');
}

describe('GET /api/integrity/jwks', () => {
  it('publishes the public JWKS (public half only)', async () => {
    const res = await JwksGET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.keys[0].kid).toBe('route-test-kid');
    expect(data.keys[0].d).toBeUndefined();
  });
});

describe('POST /api/integrity/verify', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://unit-test';
  });

  it('re-verifies a valid receipt as ok', async () => {
    const res = await VerifyPOST(makeRequest('http://localhost/api/integrity/verify', { body: { receipt: makeReceipt() } }));
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('rejects a tampered receipt', async () => {
    const receipt = makeReceipt();
    receipt.verdict = 'block';
    const res = await VerifyPOST(makeRequest('http://localhost/api/integrity/verify', { body: { receipt } }));
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('re-verifies a valid signed compliance bundle as ok', async () => {
    const bundle = signBundle({ org: 'org-1', report: '# R' }, { kid: KEY.kid, privateKeyJwk: KEY.privateKeyJwk }, '2026-06-01T00:00:00.000Z', null);
    const res = await VerifyPOST(makeRequest('http://localhost/api/integrity/verify', { body: { bundle } }));
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('rejects a tampered bundle', async () => {
    const bundle = signBundle({ org: 'org-1', report: '# R' }, { kid: KEY.kid, privateKeyJwk: KEY.privateKeyJwk }, '2026-06-01T00:00:00.000Z', null);
    bundle.payload.report = '# TAMPERED';
    const res = await VerifyPOST(makeRequest('http://localhost/api/integrity/verify', { body: { bundle } }));
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('400s when neither receipt nor bundle is provided', async () => {
    const res = await VerifyPOST(makeRequest('http://localhost/api/integrity/verify', { body: {} }));
    expect(res.status).toBe(400);
  });
});
