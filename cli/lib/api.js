/**
 * Tiny direct-API helper for the DashClaw CLI.
 *
 * The CLI imports `DashClaw` from the PUBLISHED npm package, whose installed
 * version can LAG this repo and lack newly-added SDK methods. Commands that
 * call brand-new endpoints therefore go through this helper instead — a clean
 * `fetch` with the `x-api-key` header against the already-resolved
 * baseUrl/apiKey. No dependency on unreleased SDK methods.
 *
 * Error semantics mirror sdk/dashclaw.js `_request`: parse JSON defensively
 * (fall back to {} on a non-JSON gateway/error body so the real status isn't
 * lost), and throw a status-bearing Error on a non-ok response.
 *
 * Node 20 global `fetch` — no imports needed.
 *
 * @param {{ baseUrl: string, apiKey: string }} config
 * @param {string} method
 * @param {string} path
 * @param {{ body?: any, query?: Record<string, any> }} [opts]
 * @returns {Promise<any>}
 */
export async function apiRequest({ baseUrl, apiKey }, method, path, { body, query } = {}) {
  let url = `${baseUrl}${path}`;
  if (query) {
    // Skip undefined/null values. Passing them straight into URLSearchParams
    // serializes the literal strings "undefined"/"null", which routes treat as
    // real filter values and match zero rows. Falsy-but-valid values (0, false,
    // '') are preserved.
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) qs.append(key, String(value));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Parse the body defensively. A non-JSON error body (a Vercel 502/504/413
  // gateway page, a 429 rate-limit page) makes res.json() reject with a
  // SyntaxError, which would propagate instead of the status-bearing error
  // below and lose res.status. Fall back to {} so the real status is thrown.
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    const err = new Error(data.error || `Request failed with status ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return data;
}
