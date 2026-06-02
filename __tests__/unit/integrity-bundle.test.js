import { describe, it, expect } from 'vitest';
import { signBundle, verifyBundle, bundleHash, BUNDLE_VERSION } from '../../app/lib/integrity/bundle.js';
import { generateSigningKey } from '../../app/lib/integrity/keys.js';

const KEY = generateSigningKey('bundle-kid');
const PAYLOAD = {
  org: 'org-1',
  frameworks: ['soc2'],
  windowDays: 30,
  sections: ['# Report', 'body'],
  evidenceSummary: { total: 5 },
};
const ISSUED = '2026-06-01T00:00:00.000Z';

function sign(payload, prev = null) {
  return signBundle(payload, { kid: KEY.kid, privateKeyJwk: KEY.privateKeyJwk }, ISSUED, prev);
}

describe('signBundle / verifyBundle', () => {
  it('signs a bundle that re-verifies as ok', () => {
    const b = sign(PAYLOAD);
    expect(b.version).toBe(BUNDLE_VERSION);
    expect(b.signature.alg).toBe('EdDSA');
    expect(verifyBundle(b, [KEY.publicKeyJwk]).ok).toBe(true);
  });

  it('fails when the payload is tampered', () => {
    const b = sign(PAYLOAD);
    b.payload.sections.push('INJECTED');
    expect(verifyBundle(b, [KEY.publicKeyJwk]).ok).toBe(false);
  });

  it('fails when the payloadHash is tampered', () => {
    const b = sign(PAYLOAD);
    b.payloadHash = 'sha256:deadbeef';
    expect(verifyBundle(b, [KEY.publicKeyJwk]).ok).toBe(false);
  });

  it('fails when prevBundleHash (the chain link) is tampered', () => {
    const b = sign(PAYLOAD, 'sha256:prev');
    b.prevBundleHash = 'sha256:other';
    expect(verifyBundle(b, [KEY.publicKeyJwk]).ok).toBe(false);
  });

  it('fails closed on a malformed bundle', () => {
    expect(verifyBundle({ nonsense: true }, [KEY.publicKeyJwk]).ok).toBe(false);
    expect(verifyBundle(null, [KEY.publicKeyJwk]).ok).toBe(false);
  });

  it('chains: a later bundle references the prior bundle hash', () => {
    const b1 = sign(PAYLOAD);
    const h1 = bundleHash(b1);
    const b2 = sign({ ...PAYLOAD, windowDays: 7 }, h1);
    expect(b2.prevBundleHash).toBe(h1);
    expect(verifyBundle(b2, [KEY.publicKeyJwk]).ok).toBe(true);
  });

  it('rejects when no published key matches', () => {
    const other = generateSigningKey('other');
    const b = sign(PAYLOAD);
    expect(verifyBundle(b, [other.publicKeyJwk]).ok).toBe(false);
  });

  it('fails closed (no throw) on a pathologically deep payload', () => {
    const deep = {};
    let cur = deep;
    for (let i = 0; i < 300; i++) { cur.x = {}; cur = cur.x; }
    const bad = {
      version: BUNDLE_VERSION,
      issuedAt: ISSUED,
      engineVersion: '0.1.0',
      payloadHash: 'sha256:x',
      prevBundleHash: null,
      payload: deep,
      signature: { alg: 'EdDSA', kid: 'k', sig: 'x' },
    };
    expect(() => verifyBundle(bad, [KEY.publicKeyJwk])).not.toThrow();
    expect(verifyBundle(bad, [KEY.publicKeyJwk]).ok).toBe(false);
  });
});
