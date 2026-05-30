/**
 * JWKS-based JWT verifier for agent identity (Phase 2).
 *
 * Provider-agnostic: reads the issuer from the JWT's `iss` claim and fetches
 * JWKS from `{iss}/.well-known/jwks.json` (standard OIDC discovery path).
 *
 * Supported algorithms: EdDSA (Ed25519), RS256/384/512, ES256/384/512.
 *
 * Configuration (env vars — no YAML required):
 *   DASHCLAW_ALLOWED_ISSUER  — if set, tokens from other issuers → unknown_issuer
 *   DASHCLAW_JWT_AUDIENCE    — if set, the `aud` claim must include this value
 *
 * Resilience:
 *   - 1-hour JWKS cache per issuer (TTL resets on each successful fetch)
 *   - Circuit breaker: after 3 fetch failures the breaker opens for 30 s;
 *     during open state tokens → unverified (fail-soft, not failed)
 *   - Fetch timeout: 5 s (AbortController)
 *   - Any network/outage error → unverified (not the token's fault)
 *   - SSRF defense: `iss` → `{iss}/.well-known/jwks.json` is validated
 *     by app/lib/url-safety.js before any outbound fetch (no http://,
 *     no private IPs, no DNS rebinding). UNSAFE_URL → unverified.
 *
 * Cache scope (intentional):
 *   This is a per-process Map. On Vercel each warm serverless instance
 *   gets its own cache — the "1-hour cache" is really "1-hour per warm
 *   instance." That's the right tradeoff at current scale: zero added
 *   infrastructure, zero blast-radius if cache poisoning ever happens,
 *   acceptable hit-rate when traffic keeps instances warm. Migrate to
 *   Vercel KV / Redis ONLY when (a) JWKS endpoints become a measurable
 *   cost or latency source, OR (b) we need consistent revocation
 *   semantics across instances. Until then, per-instance is correct.
 */

import { assertSafeFetchUrl } from './url-safety.js';
import { parseActBinding } from './act-binding.js';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CB_FAILURE_THRESHOLD = 3;
const CB_OPEN_MS = 30_000; // 30 s
const FETCH_TIMEOUT_MS = 5_000; // 5 s

/** @type {Map<string, { keys: object[], expiresAt: number }>} */
const jwksCache = new Map();

/** @type {Map<string, { open: boolean, openUntil: number, failures: number }>} */
const circuitBreakers = new Map();

function getCircuitBreaker(issuer) {
  return circuitBreakers.get(issuer) ?? { open: false, openUntil: 0, failures: 0 };
}

/**
 * Fetch JWKS keys for a given issuer, with cache and circuit breaker.
 * @param {string} issuer
 * @returns {Promise<object[]>} Array of JWK objects
 */
async function fetchJwks(issuer) {
  const cb = getCircuitBreaker(issuer);
  if (cb.open && Date.now() < cb.openUntil) {
    const err = new Error('circuit_open');
    err.code = 'CIRCUIT_OPEN';
    throw err;
  }

  const cached = jwksCache.get(issuer);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.keys;
  }

  const jwksUrl = `${issuer}/.well-known/jwks.json`;

  // SSRF defense: a malicious or compromised JWT can set `iss` to any URL.
  // assertSafeFetchUrl rejects http://, private/reserved IPs (loopback,
  // RFC1918, link-local 169.254.x.x for cloud metadata, etc.), and DNS
  // rebinding. Throws with code 'UNSAFE_URL' which the catch block in
  // verifyJwt treats as a network-class failure → fail-soft to 'unverified'.
  await assertSafeFetchUrl(jwksUrl);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(jwksUrl, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status} ${res.statusText}`);
    const body = await res.json();
    const keys = body.keys ?? [];

    // Don't cache an empty key set: a rolling deploy that briefly returns
    // no keys would otherwise DoS verification for the cache TTL on every
    // warm instance with no way to recover short of a redeploy.
    if (keys.length > 0) {
      jwksCache.set(issuer, { keys, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    circuitBreakers.set(issuer, { open: false, openUntil: 0, failures: 0 });
    return keys;
  } catch (err) {
    const prev = getCircuitBreaker(issuer);
    const failures = prev.failures + 1;
    if (failures >= CB_FAILURE_THRESHOLD) {
      circuitBreakers.set(issuer, { open: true, openUntil: Date.now() + CB_OPEN_MS, failures });
    } else {
      circuitBreakers.set(issuer, { ...prev, failures });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decode a base64url-encoded string to a Buffer.
 * @param {string} str
 * @returns {Buffer}
 */
function b64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  return Buffer.from(pad ? padded + '='.repeat(4 - pad) : padded, 'base64');
}

/**
 * Split a JWT into its parsed header, payload, signature, and signing input.
 * @param {string} token
 * @returns {{ header: object, payload: object, signature: Buffer, signingInput: Buffer }}
 */
function parseJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid_jwt_format');

  const header = JSON.parse(b64urlDecode(parts[0]).toString('utf8'));
  const payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
  const signature = b64urlDecode(parts[2]);
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);

  return { header, payload, signature, signingInput };
}

/**
 * Import a JWK into a WebCrypto CryptoKey for verification.
 * @param {object} jwk
 * @param {string} alg - JWT `alg` header value
 * @returns {Promise<CryptoKey>}
 */
async function importJwk(jwk, alg) {
  const { subtle } = globalThis.crypto;

  if (alg === 'EdDSA' || jwk.crv === 'Ed25519') {
    return subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify']);
  }
  if (alg === 'RS256' || alg === 'RS384' || alg === 'RS512') {
    const hash = { RS256: 'SHA-256', RS384: 'SHA-384', RS512: 'SHA-512' }[alg];
    return subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
  }
  if (alg === 'ES256' || alg === 'ES384' || alg === 'ES512') {
    const hash = { ES256: 'SHA-256', ES384: 'SHA-384', ES512: 'SHA-512' }[alg];
    const namedCurve = jwk.crv ?? { ES256: 'P-256', ES384: 'P-384', ES512: 'P-521' }[alg];
    return subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve }, false, ['verify']);
  }
  throw new Error(`unsupported_algorithm: ${alg}`);
}

/**
 * Verify a JWT signature against an imported CryptoKey.
 * @param {CryptoKey} key
 * @param {string} alg
 * @param {Buffer} signingInput
 * @param {Buffer} signature
 * @returns {Promise<boolean>}
 */
async function verifySignature(key, alg, signingInput, signature) {
  const { subtle } = globalThis.crypto;

  if (alg === 'EdDSA') {
    return subtle.verify('Ed25519', key, signature, signingInput);
  }
  if (alg.startsWith('RS')) {
    return subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signingInput);
  }
  if (alg.startsWith('ES')) {
    const hash = { ES256: 'SHA-256', ES384: 'SHA-384', ES512: 'SHA-512' }[alg];
    return subtle.verify({ name: 'ECDSA', hash }, key, signature, signingInput);
  }
  return false;
}

// Read env config at call time so tests can override process.env per-test.
function getAllowedIssuer() { return process.env.DASHCLAW_ALLOWED_ISSUER || null; }
function getJwtAudience()   { return process.env.DASHCLAW_JWT_AUDIENCE   || null; }

// Phase 2b: cap on accepted `exp`. Tokens with exp more than maxTtl seconds
// in the future defeat the replay protection (the seen set grows unbounded
// and forensic value drops). Default 24h matches the Phase 2b design in #120.
function getMaxTtlSeconds() {
  const raw = parseInt(process.env.DASHCLAW_JTI_MAX_TTL_SECONDS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 86400;
}

// Allow ±60s clock skew on the exp_too_far gate so a token whose `exp` is
// exactly the cap doesn't oscillate between accept and reject across servers
// with slightly different clocks. Conservative default; not configurable
// because this is the future-direction check (the past-direction exp/nbf
// checks would need their own skew, scope-limited to this PR).
const CLOCK_SKEW_SECONDS = 60;

/**
 * Reset module-level cache and circuit breaker state.
 * Exported for unit tests only — do not call in production code.
 * @internal
 */
export function _resetStateForTesting() {
  jwksCache.clear();
  circuitBreakers.clear();
}

/**
 * @typedef {Object} JwtVerificationResult
 * @property {'verified'|'unverified'|'expired'|'failed'|'unknown_issuer'|'exp_too_far'} verification_status
 * @property {string|null} agent_id   - JWT `sub` claim (stable agent identity)
 * @property {string|null} agent_name - JWT `agent_name` claim (human label)
 * @property {string|null} issuer     - JWT `iss` claim
 * @property {string|null} jti        - JWT `jti` claim (Phase 2b replay key)
 * @property {number|null} exp        - JWT `exp` claim in unix seconds (Phase 2b TTL)
 * @property {{ typ: string, hash: string }|null} [act] - Phase 2c action-binding
 *   claim (`urn:dashclaw:act-binding`), parsed only on the `verified` path
 *   (undefined on every other path — the guard reads it solely after confirming
 *   `verified`). null when the claim is absent or malformed.
 * @property {boolean} [act_typ_supported] - whether `act.typ` is in
 *   DASHCLAW_ACT_BINDING_TYP. Present only on the `verified` path.
 */

/**
 * Verify a JWT bearer token against JWKS.
 *
 * Returns `unverified` (not `failed`) whenever the failure is infrastructure-
 * related (network error, JWKS timeout, open circuit breaker). This ensures a
 * downed identity provider does not block agent decisions; Phase 1 body-field
 * attribution is the fallback.
 *
 * @param {string} token - Raw JWT string (without "Bearer " prefix)
 * @returns {Promise<JwtVerificationResult>}
 */
export async function verifyJwt(token) {
  let issuer = null;
  let jti = null;
  let exp = null;

  try {
    const { header, payload, signature, signingInput } = parseJwt(token);
    issuer = typeof payload.iss === 'string' ? payload.iss : null;
    jti = typeof payload.jti === 'string' ? payload.jti : null;
    exp = typeof payload.exp === 'number' ? payload.exp : null;

    // Validate allowed issuer (if configured)
    const allowedIssuer = getAllowedIssuer();
    if (allowedIssuer && issuer !== allowedIssuer) {
      return { verification_status: 'unknown_issuer', agent_id: null, agent_name: null, issuer, jti, exp };
    }

    if (!issuer) {
      return { verification_status: 'failed', agent_id: null, agent_name: null, issuer: null, jti, exp };
    }

    // Check expiry before hitting JWKS — fast path, no network
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < now) {
      return {
        verification_status: 'expired',
        agent_id: payload.sub || null,
        agent_name: payload.agent_name || null,
        issuer,
        jti,
        exp,
      };
    }

    // Phase 2b: reject tokens with exp more than maxTtl in the future.
    // A 7-day token defeats replay protection — the seen set explodes and
    // forensic value drops. ±60s skew so cap-edge tokens don't oscillate.
    if (typeof payload.exp === 'number' && payload.exp > now + getMaxTtlSeconds() + CLOCK_SKEW_SECONDS) {
      return {
        verification_status: 'exp_too_far',
        agent_id: payload.sub || null,
        agent_name: payload.agent_name || null,
        issuer,
        jti,
        exp,
      };
    }

    // Honor `nbf` (not-before): a token issued in advance of its validity
    // window must be rejected, otherwise an attacker who obtains a
    // pre-issued token can replay it before the issuer expects it to live.
    if (typeof payload.nbf === 'number' && payload.nbf > now) {
      return {
        verification_status: 'failed',
        agent_id: payload.sub || null,
        agent_name: payload.agent_name || null,
        issuer,
        jti,
        exp,
      };
    }

    // Fetch JWKS (cached; circuit breaker on repeated failures)
    const keys = await fetchJwks(issuer);

    // Filter to verification-capable keys before matching. JWKS may include
    // encryption-only keys (`use: 'enc'`); selecting one of those by kid
    // would still pass to importJwk and could verify with an unintended key.
    const sigKeys = keys.filter((k) => k.use === 'sig' || !k.use);

    // Find the correct key — prefer matching by kid, fall back to alg.
    const jwk = header.kid
      ? sigKeys.find((k) => k.kid === header.kid)
      : sigKeys.find((k) => k.alg === header.alg);

    if (!jwk) {
      return { verification_status: 'failed', agent_id: null, agent_name: null, issuer, jti, exp };
    }

    // Verify cryptographic signature
    const cryptoKey = await importJwk(jwk, header.alg);
    const valid = await verifySignature(cryptoKey, header.alg, signingInput, signature);
    if (!valid) {
      return { verification_status: 'failed', agent_id: null, agent_name: null, issuer, jti, exp };
    }

    // Validate audience (optional — only when env var is set)
    const jwtAudience = getJwtAudience();
    if (jwtAudience) {
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!aud.includes(jwtAudience)) {
        return { verification_status: 'failed', agent_id: null, agent_name: null, issuer, jti, exp };
      }
    }

    // Phase 2c (issue #121): extract the action-binding claim now that the
    // signature is trusted. The guard recomputes the digest from request
    // context one layer up and decides match/mismatch — the verifier only
    // parses and signals whether it understood the `typ`.
    const { act, actTypSupported } = parseActBinding(payload);

    return {
      verification_status: 'verified',
      agent_id: payload.sub || null,
      agent_name: payload.agent_name || null,
      issuer,
      jti,
      exp,
      act,
      act_typ_supported: actTypSupported,
    };
  } catch (err) {
    // Infrastructure failures → unverified (fail-soft, not failed)
    // These are not the token's fault; the issuer is temporarily unavailable.
    if (
      err.code === 'CIRCUIT_OPEN' ||
      err.code === 'UNSAFE_URL' ||
      err.name === 'AbortError' ||
      err.code === 'ECONNREFUSED' ||
      err.code === 'ENOTFOUND' ||
      err.code === 'ECONNRESET' ||
      err.message?.includes('JWKS fetch failed')
    ) {
      return { verification_status: 'unverified', agent_id: null, agent_name: null, issuer, jti, exp };
    }

    // Token-level errors (bad format, bad signature) → failed
    console.warn('[JWKS] JWT verification failed:', err.message);
    return { verification_status: 'failed', agent_id: null, agent_name: null, issuer, jti, exp };
  }
}

/**
 * Extract the raw token string from an Authorization header value.
 * Returns null if the header is missing or not a Bearer token.
 *
 * @param {string|null} authHeader
 * @returns {string|null}
 */
export function extractBearerToken(authHeader) {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}
