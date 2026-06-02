// __tests__/unit/oauth-crypto.test.js
import { describe, it, expect } from 'vitest';
import { base64url, sha256Hex, hashToken, newOpaqueToken, newId, verifyPkceS256 } from '../../app/lib/oauth/crypto.js';

describe('oauth crypto', () => {
  it('sha256Hex matches the middleware hashApiKey format (lowercase hex)', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashToken('abc')).toBe(sha256Hex('abc'));
  });

  it('verifyPkceS256 accepts the RFC 7636 example pair', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it('verifyPkceS256 rejects mismatches and empties', () => {
    expect(verifyPkceS256('wrong', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false);
    expect(verifyPkceS256('', '')).toBe(false);
    expect(verifyPkceS256('a', undefined)).toBe(false);
  });

  it('newOpaqueToken and newId carry their prefix and are unique', () => {
    const a = newOpaqueToken('oat');
    const b = newOpaqueToken('oat');
    expect(a.startsWith('oat_')).toBe(true);
    expect(a).not.toBe(b);
    expect(newId('ocl').startsWith('ocl_')).toBe(true);
  });

  it('base64url strips padding and is url-safe', () => {
    expect(base64url(Buffer.from([255, 255, 255]))).toBe('____');
    expect(base64url(Buffer.from('abc'))).not.toMatch(/[+/=]/);
  });
});
