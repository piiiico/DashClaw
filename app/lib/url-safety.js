/**
 * URL safety helpers for server-side outbound fetches.
 *
 * Used by any handler that fetches a URL whose host is influenced by
 * untrusted input (JWT `iss` claims, webhook URLs from settings, etc.).
 * Defends against SSRF to internal services (cloud metadata endpoints,
 * loopback, RFC1918 private networks, link-local) and DNS rebinding.
 *
 * Used by `app/api/settings/test/route.js` (connection tests) and
 * `app/lib/jwks-verifier.js` (JWT issuer JWKS fetch). This is the
 * single source of truth — never copy/paste the regex elsewhere.
 */

import dnsModule from 'node:dns/promises';

/**
 * Match common private / reserved IPv4 + IPv6 hostnames as literals.
 * Mirrors the regex in app/api/settings/test/route.js so behavior is
 * consistent across the codebase. NOTE: this is a literal-IP check —
 * it does NOT resolve hostnames. Combine with DNS resolution + per-IP
 * check to defeat DNS rebinding (see assertSafeFetchUrl below).
 */
const PRIVATE_HOSTNAME_RE =
  /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|localhost|::1|\[::1\])/i;

export function isPrivateIP(hostname) {
  return PRIVATE_HOSTNAME_RE.test(hostname);
}

/**
 * Assert that a URL is safe to fetch from a server-side handler.
 *
 *   - Protocol must be `https:` (rejects http:, file:, gopher:, data:, etc.)
 *   - Hostname literal must not be a private/reserved IP or loopback alias
 *   - DNS resolution must not return a private IP (DNS-rebinding defense)
 *
 * Throws an Error with `code: 'UNSAFE_URL'` on any failure. Callers that
 * need fail-soft behavior (e.g. the JWKS verifier) should catch and treat
 * UNSAFE_URL the same way they'd treat a network failure.
 *
 * @param {string} url
 * @param {{ dnsLookup?: typeof dnsModule.lookup }} [options]
 *   `dnsLookup` is injectable for tests (so they don't hit real DNS).
 *   Defaults to `node:dns/promises`'s `lookup`.
 */
export async function assertSafeFetchUrl(url, { dnsLookup = dnsModule.lookup } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    const err = new Error('invalid_url');
    err.code = 'UNSAFE_URL';
    throw err;
  }

  if (parsed.protocol !== 'https:') {
    const err = new Error(`non_https_url: ${parsed.protocol}`);
    err.code = 'UNSAFE_URL';
    throw err;
  }

  if (isPrivateIP(parsed.hostname)) {
    const err = new Error(`private_hostname: ${parsed.hostname}`);
    err.code = 'UNSAFE_URL';
    throw err;
  }

  // DNS rebinding defense: resolve hostname and check every returned IP.
  // A malicious domain can be configured to resolve to 127.0.0.1 even
  // though its name doesn't look private.
  let addresses;
  try {
    addresses = await dnsLookup(parsed.hostname, { all: true });
  } catch (err) {
    // DNS resolution failure is treated as unsafe — we cannot prove the
    // host is public. Tag with UNSAFE_URL so callers handle it uniformly.
    const e = new Error(`dns_lookup_failed: ${err.message}`);
    e.code = 'UNSAFE_URL';
    e.cause = err;
    throw e;
  }
  for (const { address } of addresses) {
    if (isPrivateIP(address)) {
      const err = new Error(`private_ip_after_dns: ${parsed.hostname} → ${address}`);
      err.code = 'UNSAFE_URL';
      throw err;
    }
  }
}

/**
 * Drop-in replacement for `fetch()` that validates the URL via
 * `assertSafeFetchUrl` first and disables auto-redirect (so a 30x
 * response can't redirect to a private host that bypasses the check).
 *
 * Throws `code: 'UNSAFE_URL'` on any safety failure; otherwise returns
 * a Response object identical to native fetch.
 *
 * @param {string} url
 * @param {RequestInit & { dnsLookup?: typeof dnsModule.lookup }} [options]
 */
export async function safeFetch(url, { dnsLookup, ...fetchOptions } = {}) {
  await assertSafeFetchUrl(url, { dnsLookup });
  return fetch(url, {
    redirect: 'manual', // Defense: prevent SSRF via redirect chain
    ...fetchOptions,
  });
}
