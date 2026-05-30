/**
 * Action binding (Phase 2c, issue #121 — design by @piiiico, scoped + corrected
 * in review).
 *
 * Phase 2 verifies *who* signed a token. Phase 2b stops *reusing* one. Phase 2c
 * narrows *what* a single token can do: an issuer commits the token to one
 * intended (action, target, goal) tuple at mint time, and the guard records
 * whether the incoming call matches — so a token minted to `read` a record
 * can't be repurposed to `delete` a different one (e.g. by a prompt-injected
 * agent holding an over-broad token).
 *
 * This module is the SINGLE SOURCE OF TRUTH for canonicalization + digest. The
 * issuer (which mints the claim) and the verifier (which recomputes it) must
 * agree byte-for-byte, so both sides go through here. It exists as its own file
 * precisely so those two halves cannot drift.
 *
 * Binding claim — namespaced to dodge the RFC 8693 `act` collision. 8693 uses
 * `act` for a nested *actor* object that relying parties read as `act.sub`; a
 * hash-shaped payload under that key would confuse an 8693-aware verifier, and
 * `typ`-namespacing doesn't help because such a verifier never inspects `typ`.
 * A URN claim name is collision-proof:
 *
 *   "urn:dashclaw:act-binding": {
 *     "typ":  "action-binding/v1",
 *     "hash": "sha256:<base64url-digest>"
 *   }
 *
 * Digest — a constrained RFC 8785 (JSON Canonicalization Scheme) profile. The
 * three tuple values are forced to strings and NFC-normalized, then serialized
 * with lexicographically ordered keys and no whitespace. With string-only
 * values, JCS reduces to ECMAScript JSON string-escaping (which JSON.stringify
 * already implements per ECMA-262) plus a fixed key order — so no dependency is
 * needed. The number/float canonicalization that makes general JCS hard never
 * applies here because we never hash a number.
 */

import { createHash } from 'node:crypto';

// Namespaced claim name. Deliberately NOT `act` — see module header.
export const ACT_BINDING_CLAIM = 'urn:dashclaw:act-binding';

// Default accepted `typ`. Schema evolution rides on the suffix: minting
// `action-binding/v2` invalidates v1 tokens cleanly without changing the claim
// shape. The verifier signals which `typ` it understands; the guard turns an
// unknown one into act_status='unsupported_typ', operationally distinct from absent.
const DEFAULT_TYP = 'action-binding/v1';

const MODES = ['off', 'best_effort', 'required'];

/**
 * Enforcement mode. Default `off`: act-binding needs issuer cooperation that
 * doesn't exist yet, so defaulting to anything stricter would tag every
 * legitimate verified token `not_present` and clutter audit rows for zero
 * security gain until issuers actually mint the claim.
 *
 * @returns {'off'|'best_effort'|'required'}
 */
export function getActBindingMode() {
  const raw = (process.env.DASHCLAW_ACT_BINDING || 'off').toLowerCase();
  return MODES.includes(raw) ? raw : 'off';
}

/**
 * Accepted `typ` values (comma-separated env, defaults to action-binding/v1).
 * @returns {string[]}
 */
export function getSupportedTyps() {
  const raw = process.env.DASHCLAW_ACT_BINDING_TYP || DEFAULT_TYP;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Canonicalize the (action, target, goal) tuple to the exact byte string the
 * digest is taken over. Both issuer and guard call this so the bytes match.
 *
 * Throws an error with `code: 'CTX_INCOMPLETE'` when any field is missing or
 * not a non-empty string — the guard maps that to act_status 'ctx_incomplete'
 * rather than silently hashing a partial tuple (which would always mismatch).
 *
 * @param {{ action: string, target: string, goal: string }} tuple
 * @returns {string}
 */
export function canonicalizeActionTuple({ action, target, goal } = {}) {
  for (const [key, value] of [['action', action], ['target', target], ['goal', goal]]) {
    if (typeof value !== 'string' || value.length === 0) {
      const err = new Error(`canonicalizeActionTuple: ${key} must be a non-empty string`);
      err.code = 'CTX_INCOMPLETE';
      throw err;
    }
  }
  // Keys inserted in lexicographic order (action < goal < target). ECMAScript
  // guarantees own-key enumeration for non-integer string keys follows
  // insertion order, so JSON.stringify emits them sorted regardless of how the
  // caller's input object was ordered. Values are NFC-normalized per spec.
  const ordered = {
    action: action.normalize('NFC'),
    goal: goal.normalize('NFC'),
    target: target.normalize('NFC'),
  };
  return JSON.stringify(ordered);
}

/**
 * "sha256:" + base64url(sha256(utf8(canonical))).
 * @param {{ action: string, target: string, goal: string }} tuple
 * @returns {string}
 */
export function computeActBindingHash(tuple) {
  const canonical = canonicalizeActionTuple(tuple);
  return 'sha256:' + createHash('sha256').update(canonical, 'utf8').digest('base64url');
}

/**
 * Parse the binding claim from a JWT payload. The caller MUST have already
 * verified the signature — this only reads, it does not trust.
 *
 * A present-but-malformed claim is treated as absent (`act: null`) so it can
 * never pass as a match; under `required` mode that still blocks.
 *
 * @param {object} payload - decoded JWT payload
 * @returns {{ act: ({ typ: string, hash: string }|null), actTypSupported: boolean }}
 */
export function parseActBinding(payload) {
  const raw = payload?.[ACT_BINDING_CLAIM];
  if (
    raw == null ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    typeof raw.typ !== 'string' ||
    typeof raw.hash !== 'string'
  ) {
    return { act: null, actTypSupported: false };
  }
  return {
    act: { typ: raw.typ, hash: raw.hash },
    actTypSupported: getSupportedTyps().includes(raw.typ),
  };
}

/**
 * Resolve act_status for a guard call. Pure and mode-independent: the mode
 * governs only the *block* decision (in guard.js), never the status itself, so
 * the audit row records the true observation even when DASHCLAW_ACT_BINDING=off.
 *
 * @param {object} verification - verifyJwt result (verification_status, act, act_typ_supported)
 * @param {object} ctx - guard context (action_type, target, declared_goal)
 * @returns {'not_applicable'|'not_present'|'unsupported_typ'|'ctx_incomplete'|'match'|'mismatch'}
 */
export function resolveActStatus(verification, ctx) {
  // Binding only means anything on a cryptographically verified token.
  if (!verification || verification.verification_status !== 'verified') return 'not_applicable';
  if (!verification.act) return 'not_present';
  if (!verification.act_typ_supported) return 'unsupported_typ';

  let computed;
  try {
    computed = computeActBindingHash({
      action: ctx.action_type,
      target: ctx.target,
      goal: ctx.declared_goal,
    });
  } catch (err) {
    if (err.code === 'CTX_INCOMPLETE') return 'ctx_incomplete';
    throw err;
  }
  return verification.act.hash === computed ? 'match' : 'mismatch';
}
