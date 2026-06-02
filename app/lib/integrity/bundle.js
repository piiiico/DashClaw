/**
 * Signed, hash-chained compliance bundle.
 *
 * Replaces the old unsigned compliance markdown/JSON export. A bundle wraps the
 * report payload (sections + evidence summary + metadata) in a tamper-evident,
 * independently re-verifiable envelope: the payload is bound by its digest
 * (payloadHash), the envelope is Ed25519-signed by the instance key, and each
 * bundle links to the previous one via prevBundleHash so a tampered or removed
 * export in the middle of the chain is detectable.
 *
 * Honest scope: a valid bundle proves integrity (nothing altered after issuance),
 * the issuer signature, and the chain linkage. It does NOT prove time-of-issuance
 * (`issuedAt` is issuer-asserted; there is no trusted timestamp).
 */

import { digestJson } from './canonicalize.js';
import { signCanonical, verifyCanonical } from './sign.js';
import { ENGINE_VERSION } from './receipt.js';

export const BUNDLE_VERSION = 'dashclaw-compliance-bundle/v1';

// The signed base — everything except the (potentially large) payload and the
// signature. The payload is bound by payloadHash, so the signature stays compact
// while still covering the full content transitively.
function baseOf(bundle) {
  return {
    version: bundle.version,
    issuedAt: bundle.issuedAt,
    engineVersion: bundle.engineVersion,
    payloadHash: bundle.payloadHash,
    prevBundleHash: bundle.prevBundleHash ?? null,
  };
}

/**
 * @param {object} payload - report content (sections, evidenceSummary, metadata)
 * @param {{kid:string, privateKeyJwk:object}} key
 * @param {string} issuedAt - issuer-asserted ISO timestamp (NOT trusted)
 * @param {string|null} prevBundleHash - bundleHash() of the previous export, or null
 */
export function signBundle(payload, key, issuedAt, prevBundleHash = null) {
  const base = {
    version: BUNDLE_VERSION,
    issuedAt,
    engineVersion: ENGINE_VERSION,
    payloadHash: digestJson(payload),
    prevBundleHash: prevBundleHash ?? null,
  };
  return { ...base, payload, signature: signCanonical(base, key) };
}

/** Deterministic identity hash of a bundle (over its signed base). Chains exports. */
export function bundleHash(bundle) {
  return digestJson(baseOf(bundle));
}

/**
 * Re-verify a bundle against a JWKS (or a single public JWK). Fail-closed.
 * @returns {{ ok:boolean, kid?:string, prevBundleHash?:string|null, reason?:string }}
 */
export function verifyBundle(bundle, keys) {
  try {
    if (!bundle || typeof bundle !== 'object' || !bundle.payload || !bundle.signature) {
      return { ok: false, reason: 'malformed' };
    }
    // Payload integrity: the stored payloadHash must match the live payload.
    if (digestJson(bundle.payload) !== bundle.payloadHash) {
      return { ok: false, reason: 'payload_tampered' };
    }
    const base = baseOf(bundle);
    const candidateKeys = Array.isArray(keys) ? keys : [keys];
    const kid = bundle.signature.kid;
    const matched = kid ? candidateKeys.filter((k) => k && k.kid === kid) : [];
    const tryKeys = matched.length > 0 ? matched : candidateKeys;
    for (const k of tryKeys) {
      if (verifyCanonical(base, bundle.signature, k)) {
        return { ok: true, kid: k.kid, prevBundleHash: base.prevBundleHash };
      }
    }
    return { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
