/**
 * Detached Ed25519 signatures over canonical JSON — the one signing primitive
 * shared by proof receipts and signed compliance bundles. There is a single
 * canonicalization (NFC + sorted keys + base64url, via canonicalize.js) and a
 * single scheme (Ed25519), so receipts and bundles re-verify through the same
 * published JWKS.
 */

import { sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { canonicalizeJson } from './canonicalize.js';
import { privateKeyObjectFromJwk, publicKeyObjectFromJwk } from './keys.js';

/**
 * Sign the canonical JSON of `base`.
 * @param {object} base - the object to sign (must NOT contain the signature)
 * @param {{kid:string, privateKeyJwk:object}} key
 * @returns {{ alg:'EdDSA', kid:string, sig:string }}
 */
export function signCanonical(base, key) {
  const input = Buffer.from(canonicalizeJson(base), 'utf8');
  const sig = cryptoSign(null, input, privateKeyObjectFromJwk(key.privateKeyJwk));
  return { alg: 'EdDSA', kid: key.kid, sig: sig.toString('base64url') };
}

/**
 * Verify a detached signature over the canonical JSON of `base`. Fail-closed:
 * any malformed input or error returns false.
 * @returns {boolean}
 */
export function verifyCanonical(base, signature, publicKeyJwk) {
  try {
    if (!signature || signature.alg !== 'EdDSA' || typeof signature.sig !== 'string') return false;
    return cryptoVerify(
      null,
      Buffer.from(canonicalizeJson(base), 'utf8'),
      publicKeyObjectFromJwk(publicKeyJwk),
      Buffer.from(signature.sig, 'base64url'),
    );
  } catch {
    return false;
  }
}
