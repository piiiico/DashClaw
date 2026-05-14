/**
 * HTTP client for DashClaw REST API.
 * Used by MCP tool and resource handlers.
 */
export class DashClawClient {
  /**
   * @param {Object} options
   * @param {string} [options.url] - DashClaw instance URL
   * @param {string} [options.apiKey] - API key (oc_live_ prefix)
   * @param {string} [options.agentId] - Default agent ID for tool calls
   */
  constructor({ url, apiKey, agentId } = {}) {
    this.baseUrl = (url || 'http://localhost:3000').replace(/\/$/, '');
    this.apiKey = apiKey || '';
    this.agentId = agentId || '';
  }

  async post(path, body, { timeout = 10000 } = {}) {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      const data = await res.json();
      if (!res.ok) return { ...data, _status: res.status };
      return data;
    } catch (err) {
      return { error: err.message, _status: 0 };
    }
  }

  async get(path, params = {}, { timeout = 10000 } = {}) {
    const filtered = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
    const qs = new URLSearchParams(filtered).toString();
    const url = qs ? `${this.baseUrl}${path}?${qs}` : `${this.baseUrl}${path}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'x-api-key': this.apiKey },
        signal: AbortSignal.timeout(timeout),
      });
      const data = await res.json();
      if (!res.ok) return { ...data, _status: res.status };
      return data;
    } catch (err) {
      return { error: err.message, _status: 0 };
    }
  }

  async patch(path, body, { timeout = 10000 } = {}) {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      const data = await res.json();
      if (!res.ok) return { ...data, _status: res.status };
      return data;
    } catch (err) {
      return { error: err.message, _status: 0 };
    }
  }

  /**
   * Low-level fetch passthrough used by toolkit MCP handlers that need
   * direct access to status codes (e.g., 404-as-null) and per-call methods.
   * Returns the raw Response-like object: { ok, status, json() }.
   */
  async fetch(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const headers = { 'x-api-key': this.apiKey, ...(opts.headers || {}) };
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const timeout = opts.timeout ?? 10000;
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body,
        signal: AbortSignal.timeout(timeout),
      });
      return res;
    } catch (err) {
      return {
        ok: false,
        status: 0,
        json: async () => ({ error: err.message, _status: 0 }),
      };
    }
  }
}
