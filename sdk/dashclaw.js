/**
 * DashClaw SDK v2.12.0 (Stable Runtime API)
 * Focused governance runtime client for AI agents.
 */

import { createHash } from 'crypto';

class ApprovalDeniedError extends Error {
  constructor(message, decision) {
    super(message);
    this.name = 'ApprovalDeniedError';
    this.decision = decision;
  }
}

class GuardBlockedError extends Error {
  constructor(decision) {
    super(decision.reason || 'Action blocked by policy');
    this.name = 'GuardBlockedError';
    this.decision = decision;
  }
}

class DashClaw {
  /**
   * @param {Object} options
   * @param {string} options.baseUrl - DashClaw base URL
   * @param {string} options.apiKey - API key for authentication
   * @param {string} options.agentId - Unique identifier for this agent
   * @param {string} [options.agentName] - Human-readable label for this agent (stored in audit trail)
   */
  constructor({ baseUrl, apiKey, agentId, agentName }) {
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!apiKey) throw new Error('apiKey is required');
    if (!agentId) throw new Error('agentId is required');

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.agentId = agentId;
    this.agentName = agentName || null;

    this.execution = {
      capabilities: {
        list: (filters = {}) => this.listCapabilities(filters),
        create: (data) => this.createCapability(data),
        get: (capabilityId) => this.getCapability(capabilityId),
        update: (capabilityId, patch) => this.updateCapability(capabilityId, patch),
        invoke: (capabilityId, payload = {}) => this.invokeCapability(capabilityId, payload),
        test: (capabilityId, payload = {}) => this.testCapability(capabilityId, payload),
        getHealth: (capabilityId) => this.getCapabilityHealth(capabilityId),
        listHealth: (filters = {}) => this.listCapabilityHealth(filters),
        getHistory: (capabilityId, filters = {}) => this.getCapabilityHistory(capabilityId, filters),
      },
    };
  }

  async _request(path, method = 'GET', body = null, params = null) {
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 403 && data.decision && data.decision.decision === 'block') {
        throw new GuardBlockedError(data.decision);
      }

      // Prioritize reason (from governance blocks) over generic error field
      const errorMessage = data.reason || data.error || `Request failed with status ${res.status}`;
      const err = new Error(errorMessage);
      err.status = res.status;
      err.details = data.details;
      err.decision = data;
      throw err;
    }

    return data;
  }

  /**
   * POST /api/guard — "Can I do X?"
   * @param {Object} context
   * @returns {Promise<{decision: 'allow'|'block'|'require_approval', action_id: string, reason: string, signals: string[]}>}
   */
  async guard(context) {
    return this._request('/api/guard', 'POST', {
      ...context,
      agent_id: context.agent_id || this.agentId,
      // Include agent_name for audit attribution if not already provided by caller
      ...(context.agent_name == null && this.agentName ? { agent_name: this.agentName } : {}),
    });
  }

  /**
   * POST /api/actions — "I am attempting X."
   */
  async createAction(action) {
    return this._request('/api/actions', 'POST', {
      ...action,
      agent_id: this.agentId,
    });
  }

  /**
   * PATCH /api/actions/:id — "X finished with result Y."
   */
  async updateOutcome(actionId, outcome) {
    return this._request(`/api/actions/${actionId}`, 'PATCH', {
      ...outcome,
      timestamp_end: outcome.timestamp_end || new Date().toISOString()
    });
  }

  /**
   * GET /api/actions/:id — Fetch a single action by ID.
   */
  async getAction(actionId) {
    return this._request(`/api/actions/${actionId}`, 'GET');
  }

  /**
   * GET /api/actions?status=pending_approval — List actions awaiting approval.
   */
  async getPendingApprovals(limit = 20, offset = 0) {
    return this._request('/api/actions', 'GET', null, {
      status: 'pending_approval',
      limit,
      offset,
    });
  }

  /**
   * POST /api/actions/:id/approve — Approve or deny an action.
   * @param {string} actionId
   * @param {'allow'|'deny'} decision
   * @param {string} [reasoning]
   */
  async approveAction(actionId, decision, reasoning) {
    const body = { decision };
    if (reasoning) body.reasoning = reasoning;
    return this._request(`/api/actions/${actionId}/approve`, 'POST', body);
  }

  /**
   * POST /api/assumptions — "I believe Z is true while doing X."
   */
  async recordAssumption(assumption) {
    return this._request('/api/assumptions', 'POST', assumption);
  }

  /**
   * @private Connect to SSE stream and yield parsed events.
   */
  async *_connectSSE(controller) {
    const res = await fetch(`${this.baseUrl}/api/stream`, {
      headers: { 'x-api-key': this.apiKey },
      signal: controller.signal,
    });

    if (!res.ok || !res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = null;
    let currentData = '';
    let currentId = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('id: ')) {
          currentId = line.slice(4).trim();
        } else if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData += line.slice(6);
        } else if (line.startsWith(':')) {
          // SSE comment (heartbeat)
        } else if (line === '' && currentEvent) {
          if (currentData) {
            try {
              yield { event: currentEvent, data: JSON.parse(currentData), id: currentId };
            } catch { /* ignore parse errors */ }
          }
          currentEvent = null;
          currentData = '';
          currentId = null;
        } else if (line === '') {
          currentEvent = null;
          currentData = '';
          currentId = null;
        }
      }
    }
  }

  /**
   * Wait for human approval. SSE-first with polling fallback.
   */
  async waitForApproval(actionId, { timeout = 300000, interval = 5000 } = {}) {
    const startTime = Date.now();

    const checkAction = (action) => {
      if (action.approved_by) return { resolved: true, result: { action } };
      if (action.status === 'failed' || action.status === 'cancelled') {
        return { resolved: true, error: new ApprovalDeniedError(action.error_message || 'Operator denied the action.', action.status) };
      }
      return { resolved: false };
    };

    // Try SSE first
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        for await (const frame of this._connectSSE(controller)) {
          if (frame.event === 'action.updated' && frame.data?.action_id === actionId) {
            const check = checkAction(frame.data);
            if (check.resolved) {
              clearTimeout(timeoutId);
              controller.abort();
              if (check.error) throw check.error;
              const confirmed = await this._request(`/api/actions/${actionId}`, 'GET');
              return confirmed;
            }
          }

          if (Date.now() - startTime >= timeout) {
            clearTimeout(timeoutId);
            controller.abort();
            throw new Error(`Timed out waiting for approval of action ${actionId}`);
          }
        }
      } finally {
        clearTimeout(timeoutId);
        if (!controller.signal.aborted) controller.abort();
      }
    } catch (err) {
      if (err instanceof ApprovalDeniedError || err.message?.includes('Timed out')) throw err;
      // SSE failed — fall through to polling
    }

    // Polling fallback
    let wasPending = false;
    let printedBlock = false;

    while (Date.now() - startTime < timeout) {
      const { action } = await this._request(`/api/actions/${actionId}`, 'GET');

      if (!printedBlock) {
        printedBlock = true;
        try {
          const actionType = action.action_type || 'unknown';
          const riskScore = action.risk_score != null ? String(action.risk_score) : '-';
          const goal = action.declared_goal || '-';
          const agent = action.agent_id || this.agentId;
          const replayUrl = `${this.baseUrl}/replay/${actionId}`;

          const lines = [
            '\u2554\u2550\u2550 DashClaw Approval Required \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557',
            `  Action ID:   ${actionId}`,
            `  Agent:       ${agent}`,
            `  Action:      ${actionType}`,
            '  Policy:      require_approval',
            `  Risk Score:  ${riskScore}`,
            `  Goal:        ${goal}`,
            '',
            `  Replay:      ${replayUrl}`,
            '',
            '  Waiting for approval... (Ctrl+C to abort)',
            '\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d',
          ];
          process.stdout.write('\n' + lines.join('\n') + '\n\n');
        } catch (_) { /* rendering failure must not prevent wait */ }
      }

      if (action.status === 'pending_approval') wasPending = true;
      if (action.approved_by) return { action };
      if (action.status === 'failed' || action.status === 'cancelled') {
        throw new ApprovalDeniedError(action.error_message || 'Operator denied the action.', action.status);
      }
      if (wasPending && action.status !== 'pending_approval') {
        throw new Error(`Action ${actionId} left pending_approval state without explicit approval metadata (Status: ${action.status})`);
      }
      if (!wasPending && action.status === 'running') return { action };

      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error(`Timed out waiting for approval of action ${actionId}`);
  }

  /**
   * POST /api/agents/heartbeat
   */
  async heartbeat(status = 'online', metadata = null) {
    return this._request('/api/agents/heartbeat', 'POST', {
      agent_id: this.agentId,
      status,
      metadata
    });
  }

  /**
   * POST /api/agents/connections
   */
  async reportConnections(connections) {
    return this._request('/api/agents/connections', 'POST', {
      agent_id: this.agentId,
      connections
    });
  }

  /**
   * POST /api/actions/loops
   */
  async registerOpenLoop(actionId, loopType, description, metadata = null) {
    return this._request('/api/actions/loops', 'POST', {
      action_id: actionId,
      loop_type: loopType,
      description,
      metadata
    });
  }

  /**
   * PATCH /api/actions/loops/:id
   */
  async resolveOpenLoop(loopId, status, resolution = null) {
    return this._request(`/api/actions/loops/${loopId}`, 'PATCH', {
      status,
      resolution
    });
  }

  /**
   * GET /api/actions/signals
   */
  async getSignals() {
    return this._request('/api/actions/signals');
  }

  /**
   * GET /api/learning/analytics/velocity
   */
  async getLearningVelocity(lookbackDays = 30) {
    return this._request('/api/learning/analytics/velocity', 'GET', null, {
      agent_id: this.agentId,
      lookback_days: lookbackDays
    });
  }

  /**
   * GET /api/learning/analytics/curves
   */
  async getLearningCurves(lookbackDays = 60) {
    return this._request('/api/learning/analytics/curves', 'GET', null, {
      agent_id: this.agentId,
      lookback_days: lookbackDays
    });
  }

  /**
   * GET /api/learning/lessons — Fetch consolidated lessons from scored outcomes.
   */
  async getLessons({ actionType, limit } = {}) {
    return this._request('/api/learning/lessons', 'GET', null, {
      agent_id: this.agentId,
      ...(actionType && { action_type: actionType }),
      ...(limit && { limit }),
    });
  }

  /**
   * POST /api/prompts/render
   */
  async renderPrompt({ template_id, version_id, variables, record = false }) {
    return this._request('/api/prompts/render', 'POST', {
      template_id,
      version_id,
      variables,
      agent_id: this.agentId,
      record
    });
  }

  /**
   * POST /api/evaluations/scorers
   */
  async createScorer(name, scorer_type, config = null, description = null) {
    return this._request('/api/evaluations/scorers', 'POST', {
      name,
      scorer_type,
      config,
      description
    });
  }

  /**
   * POST /api/scoring/profiles
   */
  async createScoringProfile(profile) {
    return this._request('/api/scoring/profiles', 'POST', profile);
  }

  /**
   * GET /api/scoring/profiles
   */
  async listScoringProfiles(filters = {}) {
    return this._request('/api/scoring/profiles', 'GET', null, filters);
  }

  /**
   * GET /api/scoring/profiles/:id
   */
  async getScoringProfile(profileId) {
    return this._request(`/api/scoring/profiles/${profileId}`, 'GET');
  }

  /**
   * PATCH /api/scoring/profiles/:id
   */
  async updateScoringProfile(profileId, updates) {
    return this._request(`/api/scoring/profiles/${profileId}`, 'PATCH', updates);
  }

  /**
   * DELETE /api/scoring/profiles/:id
   */
  async deleteScoringProfile(profileId) {
    return this._request(`/api/scoring/profiles/${profileId}`, 'DELETE');
  }

  /**
   * POST /api/scoring/profiles/:id/dimensions
   */
  async addScoringDimension(profileId, dimension) {
    return this._request(`/api/scoring/profiles/${profileId}/dimensions`, 'POST', dimension);
  }

  /**
   * PATCH /api/scoring/profiles/:id/dimensions/:dimId
   */
  async updateScoringDimension(profileId, dimensionId, updates) {
    return this._request(`/api/scoring/profiles/${profileId}/dimensions/${dimensionId}`, 'PATCH', updates);
  }

  /**
   * DELETE /api/scoring/profiles/:id/dimensions/:dimId
   */
  async deleteScoringDimension(profileId, dimensionId) {
    return this._request(`/api/scoring/profiles/${profileId}/dimensions/${dimensionId}`, 'DELETE');
  }

  /**
   * POST /api/scoring/score — score a single action against a profile
   */
  async scoreWithProfile(profileId, action) {
    return this._request('/api/scoring/score', 'POST', { profile_id: profileId, action });
  }

  /**
   * POST /api/scoring/score — batch score multiple actions against a profile
   */
  async batchScoreWithProfile(profileId, actions) {
    return this._request('/api/scoring/score', 'POST', { profile_id: profileId, actions });
  }

  /**
   * GET /api/scoring/score — list stored profile scores
   */
  async getProfileScores(filters = {}) {
    return this._request('/api/scoring/score', 'GET', null, filters);
  }

  /**
   * GET /api/scoring/score?view=stats — aggregate stats for a profile
   */
  async getProfileScoreStats(profileId) {
    return this._request('/api/scoring/score', 'GET', null, { profile_id: profileId, view: 'stats' });
  }

  /**
   * POST /api/scoring/risk-templates
   */
  async createRiskTemplate(template) {
    return this._request('/api/scoring/risk-templates', 'POST', template);
  }

  /**
   * GET /api/scoring/risk-templates
   */
  async listRiskTemplates(filters = {}) {
    return this._request('/api/scoring/risk-templates', 'GET', null, filters);
  }

  /**
   * PATCH /api/scoring/risk-templates/:id
   */
  async updateRiskTemplate(templateId, updates) {
    return this._request(`/api/scoring/risk-templates/${templateId}`, 'PATCH', updates);
  }

  /**
   * DELETE /api/scoring/risk-templates/:id
   */
  async deleteRiskTemplate(templateId) {
    return this._request(`/api/scoring/risk-templates/${templateId}`, 'DELETE');
  }

  /**
   * POST /api/scoring/calibrate — analyze historical data and suggest dimension thresholds
   */
  async autoCalibrate(options = {}) {
    return this._request('/api/scoring/calibrate', 'POST', options);
  }

  // ---------------------------------------------------------------------------
  // Agent Messaging
  // ---------------------------------------------------------------------------

  /**
   * POST /api/messages — Send a message to another agent or the dashboard.
   */
  async sendMessage({ to, type, subject, body, threadId, urgent, actionId }) {
    return this._request('/api/messages', 'POST', {
      from_agent_id: this.agentId,
      to_agent_id: to,
      message_type: type,
      subject,
      body,
      thread_id: threadId,
      urgent,
      action_id: actionId,
    });
  }

  /**
   * Create a scoped action context that auto-tags messages and assumptions
   * with the given action_id.
   * @param {string} actionId - The action_id to attach to all operations
   * @returns {{ sendMessage, recordAssumption, updateOutcome }}
   */
  actionContext(actionId) {
    return {
      sendMessage: ({ to, type, subject, body, threadId, urgent }) => {
        return this.sendMessage({ to, type, subject, body, threadId, urgent, actionId });
      },
      recordAssumption: (assumption) => {
        return this.recordAssumption({ ...assumption, action_id: actionId });
      },
      updateOutcome: (outcome) => {
        return this.updateOutcome(actionId, outcome);
      },
    };
  }

  /**
   * GET /api/messages — Fetch this agent's inbox.
   */
  async getInbox({ type, unread, limit } = {}) {
    return this._request('/api/messages', 'GET', null, {
      agent_id: this.agentId,
      direction: 'inbox',
      ...(type && { type }),
      ...(unread != null && { unread }),
      ...(limit && { limit }),
    });
  }

  // ---------------------------------------------------------------------------
  // Session Handoffs
  // ---------------------------------------------------------------------------

  /**
   * POST /api/handoffs — Create a session handoff record.
   */
  async createHandoff(handoff) {
    return this._request('/api/handoffs', 'POST', {
      agent_id: this.agentId,
      ...handoff,
    });
  }

  /**
   * GET /api/handoffs — Fetch the most recent handoff for this agent.
   */
  async getLatestHandoff() {
    return this._request('/api/handoffs', 'GET', null, {
      agent_id: this.agentId,
      latest: 'true',
    });
  }

  // ---------------------------------------------------------------------------
  // Security Scanning
  // ---------------------------------------------------------------------------

  /**
   * POST /api/security/prompt-injection — Scan text for prompt injection attacks.
   */
  async scanPromptInjection(text, { source } = {}) {
    return this._request('/api/security/prompt-injection', 'POST', {
      text,
      source,
      agent_id: this.agentId,
    });
  }

  // ---------------------------------------------------------------------------
  // User Feedback
  // ---------------------------------------------------------------------------

  /**
   * POST /api/feedback — Submit user feedback linked to an action.
   */
  async submitFeedback({ action_id, rating, comment, category, tags, metadata }) {
    return this._request('/api/feedback', 'POST', {
      action_id,
      agent_id: this.agentId,
      rating,
      comment,
      category,
      tags,
      metadata,
    });
  }

  // ---------------------------------------------------------------------------
  // Context Threads
  // ---------------------------------------------------------------------------

  /**
   * POST /api/context/threads — Create a reasoning context thread.
   */
  async createThread(thread) {
    return this._request('/api/context/threads', 'POST', {
      agent_id: this.agentId,
      ...thread,
    });
  }

  /**
   * POST /api/context/threads/:id/entries — Append a reasoning step.
   */
  async addThreadEntry(threadId, content, entryType) {
    return this._request(`/api/context/threads/${threadId}/entries`, 'POST', {
      content,
      entry_type: entryType,
    });
  }

  /**
   * PATCH /api/context/threads/:id — Close a reasoning thread.
   */
  async closeThread(threadId, summary) {
    return this._request(`/api/context/threads/${threadId}`, 'PATCH', {
      status: 'closed',
      ...(summary ? { summary } : {}),
    });
  }

  // ---------------------------------------------------------------------------
  // Bulk Sync
  // ---------------------------------------------------------------------------

  /**
   * POST /api/sync — Bulk state sync for periodic updates or bootstrap.
   */
  async syncState(state) {
    return this._request('/api/sync', 'POST', {
      agent_id: this.agentId,
      ...state,
    });
  }

  // ---------------------------------------------------------------------------
  // Session Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * POST /api/sessions — Create a new agent session.
   * @param {string} agentId - Agent identifier (defaults to this.agentId)
   * @param {string} workspace - Workspace path or identifier
   * @param {string|null} [branch=null] - Optional git branch
   */
  async createSession(agentId, workspace, branch = null) {
    return this._request('/api/sessions', 'POST', {
      agent_id: agentId || this.agentId,
      workspace,
      branch,
    });
  }

  /**
   * GET /api/sessions/:id — Fetch a single session by ID.
   */
  async getSession(sessionId) {
    return this._request(`/api/sessions/${sessionId}`, 'GET');
  }

  /**
   * PATCH /api/sessions/:id — Update session state.
   * @param {string} sessionId
   * @param {Object} updates - Fields to update (status, green_level, branch_freshness, commits_behind, blocked_reason)
   */
  async updateSession(sessionId, updates) {
    return this._request(`/api/sessions/${sessionId}`, 'PATCH', updates);
  }

  /**
   * GET /api/sessions — List sessions with optional filters.
   * @param {Object} [filters={}] - Query filters (agent_id, status, limit)
   */
  async listSessions(filters = {}) {
    return this._request('/api/sessions', 'GET', null, filters);
  }

  /**
   * GET /api/sessions/:id/events — Fetch events for a session.
   */
  async getSessionEvents(sessionId) {
    return this._request(`/api/sessions/${sessionId}/events`, 'GET');
  }

  // ---------------------------------------------------------------------------
  // Execution Studio — Execution Graph
  // ---------------------------------------------------------------------------

  /**
   * GET /api/actions/:id/graph — Read-only execution graph (nodes + edges).
   */
  async getActionGraph(actionId) {
    return this._request(`/api/actions/${actionId}/graph`, 'GET');
  }

  // ---------------------------------------------------------------------------
  // Durable execution finality — terminal outcome reporting
  // See docs/architecture/durable-execution-finality.md
  // ---------------------------------------------------------------------------

  /**
   * POST /api/actions/:id/outcome — Record the terminal outcome of an action.
   *
   * @param {string} actionId
   * @param {Object} payload
   * @param {'completed'|'partial'|'failed'} payload.status
   * @param {string} [payload.summary]
   * @param {string} [payload.error_message] — required when status=failed
   * @param {Object} [payload.progress] — required when status=partial
   * @returns {Promise<{ outcome: object, security: object }>}
   * @throws on 409 when the outcome is already terminal — inspect the response
   *   body for `current_status` before deciding what to do next.
   */
  async reportActionOutcome(actionId, payload) {
    return this._request(`/api/actions/${actionId}/outcome`, 'POST', payload);
  }

  /**
   * GET /api/actions/:id/outcome — Read the current outcome state of an action.
   *
   * Returns `{ action_id, status, outcome_at, summary, error_message, progress, elapsed_ms }`.
   * Status is one of: pending, completed, partial, failed, lost_confirmation.
   * Use this BEFORE retrying any approved action to avoid double-execution.
   */
  async getActionOutcome(actionId) {
    return this._request(`/api/actions/${actionId}/outcome`, 'GET');
  }

  /**
   * Convenience: report a successful terminal outcome.
   */
  async reportActionSuccess(actionId, summary) {
    return this.reportActionOutcome(actionId, { status: 'completed', summary });
  }

  /**
   * Convenience: report a failed terminal outcome. `error_message` is required.
   */
  async reportActionFailure(actionId, errorMessage, summary) {
    return this.reportActionOutcome(actionId, {
      status: 'failed',
      error_message: errorMessage,
      summary,
    });
  }

  /**
   * Convenience: report a partial outcome with progress state. Progress is
   * required (an object describing where the agent stopped).
   */
  async reportActionPartial(actionId, progress, summary) {
    return this.reportActionOutcome(actionId, {
      status: 'partial',
      progress,
      summary,
    });
  }

  /**
   * Derive a stable idempotency key from the *intent* of an action so a
   * retried `createAction` call returns the original row instead of creating
   * a duplicate. Pass the same `parts` for the same logical action; vary at
   * least one part for distinct actions.
   *
   * The hash function uses SHA-256 hex via Node's built-in crypto. In
   * browser-only environments lacking `require`, callers should compute the
   * key themselves and pass it directly to `createAction({ idempotency_key }).`
   *
   * @param {Object} parts — at minimum agent_id + action_type + a request
   *   discriminator that uniquely identifies this attempt. Reusing the key
   *   for a logically distinct action is the agent's bug, not DashClaw's.
   * @returns {string} SHA-256 hex digest
   */
  deriveIdempotencyKey(parts) {
    if (!parts || typeof parts !== 'object') {
      throw new TypeError('deriveIdempotencyKey: parts must be an object');
    }
    const ordered = Object.keys(parts)
      .sort()
      .map((k) => `${k}=${parts[k] ?? ''}`)
      .join('|');
    return createHash('sha256').update(ordered).digest('hex');
  }

  // ---------------------------------------------------------------------------
  // Execution Studio — Workflow Templates
  // ---------------------------------------------------------------------------

  /**
   * GET /api/workflows/templates — List workflow templates.
   * @param {Object} [filters={}] - { status, limit, offset }
   */
  async listWorkflowTemplates(filters = {}) {
    return this._request('/api/workflows/templates', 'GET', null, filters);
  }

  /**
   * POST /api/workflows/templates — Create a workflow template.
   */
  async createWorkflowTemplate(data) {
    return this._request('/api/workflows/templates', 'POST', data);
  }

  /**
   * GET /api/workflows/templates/:id — Fetch a single template.
   */
  async getWorkflowTemplate(templateId) {
    return this._request(`/api/workflows/templates/${templateId}`, 'GET');
  }

  /**
   * PATCH /api/workflows/templates/:id — Partial update. Bumps version when steps change.
   */
  async updateWorkflowTemplate(templateId, patch) {
    return this._request(`/api/workflows/templates/${templateId}`, 'PATCH', patch);
  }

  /**
   * POST /api/workflows/templates/:id/duplicate — Clone as a new draft.
   */
  async duplicateWorkflowTemplate(templateId, overrides = {}) {
    return this._request(`/api/workflows/templates/${templateId}/duplicate`, 'POST', overrides);
  }

  /**
   * POST /api/workflows/templates/:id/launch — Create a traceable action record.
   * Resolves any linked model strategy into a snapshot at launch time.
   */
  async launchWorkflowTemplate(templateId, options = {}) {
    return this._request(`/api/workflows/templates/${templateId}/launch`, 'POST', options);
  }

  // ---------------------------------------------------------------------------
  // Execution Studio — Model Strategies
  // ---------------------------------------------------------------------------

  /**
   * GET /api/model-strategies — List model strategies.
   */
  async listModelStrategies() {
    return this._request('/api/model-strategies', 'GET');
  }

  /**
   * POST /api/model-strategies — Create a model strategy.
   * @param {Object} data - { name, description, config: { primary, fallback, costSensitivity, ... } }
   */
  async createModelStrategy(data) {
    return this._request('/api/model-strategies', 'POST', data);
  }

  /**
   * GET /api/model-strategies/:id — Fetch a single strategy.
   */
  async getModelStrategy(strategyId) {
    return this._request(`/api/model-strategies/${strategyId}`, 'GET');
  }

  /**
   * PATCH /api/model-strategies/:id — Partial update. Config patches merge over existing.
   */
  async updateModelStrategy(strategyId, patch) {
    return this._request(`/api/model-strategies/${strategyId}`, 'PATCH', patch);
  }

  /**
   * DELETE /api/model-strategies/:id — Delete. Nulls soft refs on linked templates.
   */
  async deleteModelStrategy(strategyId) {
    return this._request(`/api/model-strategies/${strategyId}`, 'DELETE');
  }

  /**
   * POST /api/model-strategies/:id/complete — Execute a chat completion using
   * this strategy. Resolves BYOK provider credentials, handles fallback chain,
   * enforces budget caps.
   * @param {string} strategyId
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} [options={}] - { max_tokens, temperature, task_mode }
   */
  async completeWithStrategy(strategyId, messages, options = {}) {
    return this._request(`/api/model-strategies/${strategyId}/complete`, 'POST', {
      messages,
      ...options,
    });
  }

  // ---------------------------------------------------------------------------
  // Execution Studio — Knowledge Collections
  // ---------------------------------------------------------------------------

  /**
   * GET /api/knowledge/collections — List knowledge collections.
   * @param {Object} [filters={}] - { sourceType, limit, offset }
   */
  async listKnowledgeCollections(filters = {}) {
    const params = {};
    if (filters.sourceType) params.source_type = filters.sourceType;
    if (filters.limit) params.limit = filters.limit;
    if (filters.offset) params.offset = filters.offset;
    return this._request('/api/knowledge/collections', 'GET', null, params);
  }

  /**
   * POST /api/knowledge/collections — Create a knowledge collection.
   */
  async createKnowledgeCollection(data) {
    return this._request('/api/knowledge/collections', 'POST', data);
  }

  /**
   * GET /api/knowledge/collections/:id — Fetch a single collection.
   */
  async getKnowledgeCollection(collectionId) {
    return this._request(`/api/knowledge/collections/${collectionId}`, 'GET');
  }

  /**
   * PATCH /api/knowledge/collections/:id — Update collection metadata.
   */
  async updateKnowledgeCollection(collectionId, patch) {
    return this._request(`/api/knowledge/collections/${collectionId}`, 'PATCH', patch);
  }

  /**
   * GET /api/knowledge/collections/:id/items — List items in a collection.
   * @param {Object} [filters={}] - { limit, offset }
   */
  async listKnowledgeCollectionItems(collectionId, filters = {}) {
    return this._request(`/api/knowledge/collections/${collectionId}/items`, 'GET', null, filters);
  }

  /**
   * POST /api/knowledge/collections/:id/items — Add an item. Bumps parent doc_count.
   */
  async addKnowledgeCollectionItem(collectionId, data) {
    return this._request(`/api/knowledge/collections/${collectionId}/items`, 'POST', data);
  }

  /**
   * POST /api/knowledge/collections/:id/sync — Ingest pending items (chunk + embed).
   */
  async syncKnowledgeCollection(collectionId) {
    return this._request(`/api/knowledge/collections/${collectionId}/sync`, 'POST', {});
  }

  /**
   * POST /api/knowledge/collections/:id/search — Semantic search over chunks.
   * @param {string} collectionId
   * @param {string} query
   * @param {Object} [options={}] - { limit }
   */
  async searchKnowledgeCollection(collectionId, query, options = {}) {
    return this._request(`/api/knowledge/collections/${collectionId}/search`, 'POST', {
      query,
      ...options,
    });
  }

  // ---------------------------------------------------------------------------
  // Execution Studio — Capability Registry
  // ---------------------------------------------------------------------------

  /**
   * GET /api/capabilities — Search the capability registry.
   * @param {Object} [filters={}] - { category, risk_level, search, limit, offset }
   */
  async listCapabilities(filters = {}) {
    return this._request('/api/capabilities', 'GET', null, filters);
  }

  /**
   * POST /api/capabilities — Register a capability.
   */
  async createCapability(data) {
    return this._request('/api/capabilities', 'POST', data);
  }

  /**
   * GET /api/capabilities/:id — Fetch a single capability.
   */
  async getCapability(capabilityId) {
    return this._request(`/api/capabilities/${capabilityId}`, 'GET');
  }

  /**
   * PATCH /api/capabilities/:id — Update a capability.
   */
  async updateCapability(capabilityId, patch) {
    return this._request(`/api/capabilities/${capabilityId}`, 'PATCH', patch);
  }

  /**
   * POST /api/capabilities/:id/invoke — Invoke a governed capability.
   */
  async invokeCapability(capabilityId, payload = {}) {
    return this._request(`/api/capabilities/${capabilityId}/invoke`, 'POST', {
      ...payload,
      agent_id: payload.agent_id || this.agentId,
    });
  }

  /**
   * POST /api/capabilities/:id/test — Run a non-production capability validation call.
   */
  async testCapability(capabilityId, payload = {}) {
    return this._request(`/api/capabilities/${capabilityId}/test`, 'POST', {
      ...payload,
      agent_id: payload.agent_id || this.agentId,
    });
  }

  /**
   * GET /api/capabilities/:id/health — Fetch derived capability health.
   */
  async getCapabilityHealth(capabilityId) {
    return this._request(`/api/capabilities/${capabilityId}/health`, 'GET');
  }

  /**
   * GET /api/capabilities/health — List derived health summaries for matching capabilities.
   */
  async listCapabilityHealth(filters = {}) {
    return this._request('/api/capabilities/health', 'GET', null, filters);
  }

  /**
   * GET /api/capabilities/:id/history — Fetch recent test and invoke events for a capability.
   */
  async getCapabilityHistory(capabilityId, filters = {}) {
    return this._request(`/api/capabilities/${capabilityId}/history`, 'GET', null, filters);
  }
}

export { DashClaw, ApprovalDeniedError, GuardBlockedError };
