import { describe, it, expect } from 'vitest';
import {
  issueReceipt,
  verifyReceipt,
  hashSourceOfTruth,
  ENGINE_VERSION,
  RECEIPT_VERSION,
} from '../../app/lib/integrity/receipt.js';
import { generateSigningKey } from '../../app/lib/integrity/keys.js';
import { verify } from '../../app/lib/integrity/verify.js';

// Ported from GroundLock packages/core/tests/receipt.test.ts + ruleset.test.ts,
// rebranded to DashClaw. A signed receipt proves integrity, the verdict, the
// ruleset version, and the issuer signature — nothing about time-of-issuance.

const source = {
  requiredFacts: [{ label: 'tenant', value: 'Jane Roe' }],
  allowedFacts: [{ label: 'tenant', value: 'Jane Roe' }],
  extract: { money: false, dates: false, percentages: false },
};
const candidate = 'Dear Jane Roe, this is a notice.';
const issuedAt = '2026-06-01T00:00:00.000Z';

describe('receipt', () => {
  it('issues a receipt that round-trips verification and strips violation detail', () => {
    const kp = generateSigningKey('k1');
    const result = verify(candidate, source);
    const receipt = issueReceipt(result, candidate, source, { kid: kp.kid, privateKeyJwk: kp.privateKeyJwk }, issuedAt);

    expect(receipt.version).toBe(RECEIPT_VERSION);
    expect(receipt.engineVersion).toBe(ENGINE_VERSION);
    expect(receipt.verdict).toBe('pass');
    expect(receipt.signature.alg).toBe('EdDSA');
    expect(receipt.candidateHash).toMatch(/^sha256:/);
    // privacy: receipt violations never carry a raw detail field
    expect(receipt.violations.every((v) => !('detail' in v))).toBe(true);

    expect(verifyReceipt(receipt, kp.publicKeyJwk)).toEqual({ ok: true });
  });

  it('fails verification when any field is tampered', () => {
    const kp = generateSigningKey('k1');
    const receipt = issueReceipt(verify(candidate, source), candidate, source, { kid: kp.kid, privateKeyJwk: kp.privateKeyJwk }, issuedAt);

    const tampered = { ...receipt, verdict: 'block' };
    expect(verifyReceipt(tampered, kp.publicKeyJwk).ok).toBe(false);

    const tampered2 = { ...receipt, candidateHash: 'sha256:deadbeef' };
    expect(verifyReceipt(tampered2, kp.publicKeyJwk).ok).toBe(false);
  });

  it('fails closed on a malformed receipt', () => {
    const kp = generateSigningKey('k1');
    expect(verifyReceipt({ nonsense: true }, kp.publicKeyJwk).ok).toBe(false);
  });

  it('records the block verdict for a fabricated candidate and still re-verifies', () => {
    const kp = generateSigningKey('k1');
    const badResult = verify('Dear John Doe, this is a notice.', source);
    expect(badResult.verdict).toBe('block');
    const receipt = issueReceipt(badResult, 'Dear John Doe, this is a notice.', source, { kid: kp.kid, privateKeyJwk: kp.privateKeyJwk }, issuedAt);
    expect(receipt.verdict).toBe('block');
    expect(receipt.violations.some((v) => v.code === 'missing_required')).toBe(true);
    expect(verifyReceipt(receipt, kp.publicKeyJwk).ok).toBe(true);
  });
});

describe('hashSourceOfTruth', () => {
  const src = {
    requiredFacts: [{ label: 'a', value: 'x' }],
    allowedFacts: [{ label: 'a', value: 'x' }],
  };

  it('is stable and sha256-framed', () => {
    expect(hashSourceOfTruth(src)).toBe(hashSourceOfTruth(src));
    expect(hashSourceOfTruth(src)).toMatch(/^sha256:[A-Za-z0-9_-]+$/);
  });

  it('changes when an allowed fact changes', () => {
    const other = { ...src, allowedFacts: [{ label: 'a', value: 'y' }] };
    expect(hashSourceOfTruth(other)).not.toBe(hashSourceOfTruth(src));
  });
});
