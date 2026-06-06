// cli/lib/posture.js
//
// Direct-API helpers for the `dashclaw posture` / `dashclaw next` commands.
// Like the other CLI command groups, these call the live endpoints via
// apiRequest (fetch + x-api-key) rather than the published SDK, so the CLI never
// depends on a possibly-stale `dashclaw` package for newly-added routes.
//
// Resolve is DRAFT-ONLY: the CLI can create an inactive policy draft, snooze, or
// accept risk — it can NEVER activate enforcement. An operator (or agent) can
// prepare a fix; only a human activates it at /policies. Mirrors the API + MCP
// ceiling so agents can never self-escalate their own governance.

import { apiRequest } from './api.js';

/** GET /api/posture — score + dimensions + findings + summary + trend. */
export async function fetchPosture(config) {
  return apiRequest(config, 'GET', '/api/posture');
}

/** GET /api/posture/findings — the prioritized queue (+ optional filters). */
export async function fetchFindings(config, { status, dimension } = {}) {
  return apiRequest(config, 'GET', '/api/posture/findings', { query: { status, dimension } });
}

/** The single top open finding (the `next` gap), or null when the queue is clear. */
export async function fetchNext(config) {
  const data = await fetchFindings(config);
  return (data && Array.isArray(data.findings) && data.findings[0]) || null;
}

const RESOLVE_ACTIONS = new Set(['create_draft', 'snooze', 'accept_risk']);

/**
 * POST /api/posture/findings/<key>/resolve — DRAFT-ONLY actions.
 * `create_draft` (default) inserts an inactive policy draft; snooze/accept_risk
 * record state. None of these activate enforcement.
 */
export async function resolveFinding(config, key, action = 'create_draft', note) {
  if (!RESOLVE_ACTIONS.has(action)) {
    throw new Error(`Invalid resolve action "${action}". Draft-only: ${[...RESOLVE_ACTIONS].join(', ')}.`);
  }
  return apiRequest(config, 'POST', `/api/posture/findings/${encodeURIComponent(key)}/resolve`, {
    body: { action, note },
  });
}
