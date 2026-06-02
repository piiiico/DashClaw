/**
 * Signed, independently re-verifiable proof receipts + ruleset hashing.
 *
 * Ported/adapted from GroundLock packages/core/src/receipt.ts + ruleset.ts,
 * rebranded to DashClaw. A receipt binds: the verdict, the structured
 * violations (code + label only — raw detail is stripped for privacy), a hash
 * of the candidate text, a hash of the source-of-truth (the "ruleset version"),
 * and an Ed25519 issuer signature.
 *
 * Honest scope: a valid receipt proves integrity (nothing was altered after
 * issuance), the verdict, the ruleset version, and the issuer's signature. It
 * does NOT prove time-of-issuance — `issuedAt` is issuer-asserted, there is no
 * trusted timestamp — nor the semantic correctness of prose that carries no
 * extractable operational token.
 */

import { digestText, digestJson } from './canonicalize.js';
import { signCanonical, verifyCanonical } from './sign.js';

export const ENGINE_VERSION = '0.1.0'; // version-hardcode-allowed (integrity engine version, not the platform version)
export const RECEIPT_VERSION = 'dashclaw-receipt/v1';

/** Stable content hash of the source-of-truth, used as the ruleset version in a receipt. */
export function hashSourceOfTruth(source) {
  return digestJson({
    requiredFacts: source.requiredFacts,
    allowedFacts: source.allowedFacts,
    forbiddenPatterns: source.forbiddenPatterns ?? [],
    extract: source.extract ?? {},
  });
}

/**
 * Issue a signed receipt for a verify() result.
 *
 * @param {{verdict:string, violations:Array}} result
 * @param {string} candidate
 * @param {object} source - source-of-truth
 * @param {{kid:string, privateKeyJwk:object}} key
 * @param {string} issuedAt - issuer-asserted ISO timestamp (NOT a trusted timestamp)
 */
export function issueReceipt(result, candidate, source, key, issuedAt) {
  const base = {
    version: RECEIPT_VERSION,
    issuedAt,
    engineVersion: ENGINE_VERSION,
    verdict: result.verdict,
    violations: result.violations.map((v) => ({ code: v.code, label: v.label })),
    candidateHash: digestText(candidate),
    sourceOfTruthHash: hashSourceOfTruth(source),
  };
  return { ...base, signature: signCanonical(base, key) };
}

/**
 * Re-verify a receipt against a public JWK. Fail-closed: any malformed input,
 * unsupported signature, or error returns { ok: false }.
 *
 * @param {object} receipt
 * @param {object} publicKeyJwk
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifyReceipt(receipt, publicKeyJwk) {
  try {
    if (!receipt || typeof receipt !== 'object') return { ok: false, reason: 'malformed' };
    const { signature, ...base } = receipt;
    if (!signature || signature.alg !== 'EdDSA' || typeof signature.sig !== 'string') {
      return { ok: false, reason: 'unsupported_signature' };
    }
    const ok = verifyCanonical(base, signature, publicKeyJwk);
    return ok ? { ok: true } : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'error' }; // fail-closed
  }
}
