/**
 * Capability invocation engine.
 * Handles auth resolution, HTTP calls with timeout, retry with backoff,
 * and request/response mapping.
 */

import { mapRequest, mapResponse } from './mapping.js';
import { safeUrlWithIps, buildPinnedDispatcher } from './webhooks.js';

export const RISK_SCORE_MAP = {
  low: 20,
  medium: 50,
  high: 75,
  critical: 95,
};

const DEFAULT_RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export function resolveAuth(auth, settings) {
  if (!auth || auth.type === 'none') return {};

  const tokenKey = auth.token_setting;
  if (!tokenKey) return {};

  const token = settings[tokenKey];
  if (!token) {
    const err = new Error(`auth_not_configured: setting '${tokenKey}' not configured for this capability`);
    err.code = 'auth_not_configured';
    throw err;
  }

  if (auth.type === 'bearer') {
    return { Authorization: `Bearer ${token}` };
  }
  if (auth.type === 'api_key') {
    return { 'x-api-key': token };
  }
  return {};
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function calculateBackoffDelay(attempt, backoff, baseDelayMs, maxDelayMs) {
  if (!backoff || backoff === 'none') return 0;
  if (backoff === 'fixed') return baseDelayMs;
  // exponential: base * 2^attempt with jitter, capped at max
  const delay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * delay * 0.1;
  return Math.min(Math.floor(delay + jitter), maxDelayMs);
}

export function isRetryableResult(result, retryableStatusCodes) {
  if (result.success) return false;
  if (result.error === 'capability_timeout') return true;
  if (result.error === 'capability_network_error') return true;
  if (result.error === 'capability_error' && retryableStatusCodes.has(result.status)) return true;
  return false;
}

async function singleAttempt({
  endpoint,
  method,
  authHeaders,
  body,
  requestMapping,
  responseMapping,
  timeoutMs,
}) {
  const mappedBody = mapRequest(body, requestMapping);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 60000);
  const start = Date.now();

  // GET and HEAD cannot carry a request body per the fetch/undici spec.
  // Attaching one causes an immediate "Request with GET/HEAD method cannot
  // have body" TypeError before the request ever leaves the process.
  const normalizedMethod = (method || 'POST').toUpperCase();
  const bodylessMethod = normalizedMethod === 'GET' || normalizedMethod === 'HEAD';

  try {
    // SSRF defense: capability endpoints come from operator-configured DB rows
    // (admins can PATCH them). Validate https://, reject private/loopback IPs,
    // and pin DNS resolution to a public IP so a rebinding attacker cannot swap
    // the address mid-flight. Mirrors the pattern used in webhooks.js.
    const validatedIps = await safeUrlWithIps(endpoint);
    const dispatcher = buildPinnedDispatcher(validatedIps);

    const response = await fetch(endpoint, {
      method: normalizedMethod,
      redirect: 'manual', // SECURITY: prevent SSRF via redirect chain
      headers: {
        ...(bodylessMethod ? {} : { 'Content-Type': 'application/json' }),
        ...authHeaders,
      },
      ...(bodylessMethod ? {} : { body: JSON.stringify(mappedBody) }),
      signal: controller.signal,
      dispatcher,
    });

    clearTimeout(timer);
    const elapsedMs = Date.now() - start;

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return {
        success: false,
        error: 'capability_error',
        status: response.status,
        message: errorText.slice(0, 500),
        elapsed_ms: elapsedMs,
      };
    }

    const rawData = await response.json();
    const data = mapResponse(rawData, responseMapping);

    return {
      success: true,
      data,
      raw: rawData,
      elapsed_ms: elapsedMs,
    };
  } catch (err) {
    clearTimeout(timer);
    const elapsedMs = Date.now() - start;

    if (err.name === 'AbortError') {
      return {
        success: false,
        error: 'capability_timeout',
        message: `Capability timed out after ${timeoutMs || 60000}ms`,
        elapsed_ms: elapsedMs,
      };
    }

    return {
      success: false,
      error: 'capability_network_error',
      message: err.message,
      elapsed_ms: elapsedMs,
    };
  }
}

export async function invokeCapability({
  endpoint,
  method,
  authHeaders,
  body,
  requestMapping,
  responseMapping,
  timeoutMs,
  retryPolicy,
}) {
  const maxRetries = retryPolicy?.max_retries || 0;

  // Fast path: no retries configured — identical to previous behavior
  if (maxRetries === 0) {
    return singleAttempt({ endpoint, method, authHeaders, body, requestMapping, responseMapping, timeoutMs });
  }

  const backoff = retryPolicy.backoff || 'none';
  const baseDelayMs = retryPolicy.base_delay_ms || 1000;
  const maxDelayMs = retryPolicy.max_delay_ms || 30000;
  const retryableStatusCodes = retryPolicy.retryable_status_codes
    ? new Set(retryPolicy.retryable_status_codes)
    : DEFAULT_RETRYABLE_STATUS_CODES;

  const attempts = [];
  const totalStart = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await singleAttempt({
      endpoint, method, authHeaders, body, requestMapping, responseMapping, timeoutMs,
    });

    attempts.push({
      attempt: attempt + 1,
      ...(result.success ? { success: true } : { error: result.error, status: result.status }),
      elapsed_ms: result.elapsed_ms,
    });

    if (result.success) {
      return {
        ...result,
        elapsed_ms: Date.now() - totalStart,
        retry_metadata: {
          total_attempts: attempt + 1,
          retried: attempt > 0,
          attempts,
        },
      };
    }

    // Last attempt or non-retryable — return failure
    if (attempt === maxRetries || !isRetryableResult(result, retryableStatusCodes)) {
      return {
        ...result,
        elapsed_ms: Date.now() - totalStart,
        retry_metadata: {
          total_attempts: attempt + 1,
          retried: attempt > 0,
          attempts,
        },
      };
    }

    // Wait before next attempt
    const delay = calculateBackoffDelay(attempt, backoff, baseDelayMs, maxDelayMs);
    if (delay > 0) {
      await sleep(delay);
    }
  }
}
