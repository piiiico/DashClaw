/**
 * DashClaw SDK v2.7.0 (Stable Runtime API)
 * Focused governance runtime client for AI agents.
 */

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
   */
  constructor({ baseUrl, apiKey, agentId }) {
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!apiKey) throw new Error('apiKey is required');
    if (!agentId) throw new Error('agentId is required');

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.agentId = agentId;
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
   * GET /api/actions/:id — Polling helper for human approval.
   */
  async waitForApproval(actionId, { timeout = 300000, interval = 5000 } = {}) {
    const startTime = Date.now();
    let wasPending = false;
    let printedBlock = false;

    while (Date.now() - startTime < timeout) {
      const { action } = await this._request(`/api/actions/${actionId}`, 'GET');

      // Print structured approval block on first fetch
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
        } catch (_) {
          // Rendering failure must not prevent the wait from proceeding
        }
      }
      
      if (action.status === 'pending_approval') {
        wasPending = true;
      }

      // Explicitly unblocked by approval metadata
      if (action.approved_by) return action;

      // Denial cases
      if (action.status === 'failed' || action.status === 'cancelled') {
        throw new ApprovalDeniedError(action.error_message || 'Operator denied the action.', action.status);
      }

      // Requirement 4: If an action leaves pending_approval without approval metadata, throw an error.
      // This prevents "auto-approval" bugs where status is changed by non-approval paths.
      if (wasPending && action.status !== 'pending_approval') {
        throw new Error(`Action ${actionId} left pending_approval state without explicit approval metadata (Status: ${action.status})`);
      }

      // If allowed directly (never intercepted), return immediately
      if (!wasPending && action.status === 'running') {
        return { action };
      }

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
}

export { DashClaw, ApprovalDeniedError, GuardBlockedError };
