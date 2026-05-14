// mcp-server/lib/tools.js

/**
 * DashClaw MCP tool definitions and handlers.
 * Tool definitions follow JSON Schema (for both MCP registerTool and JSON-RPC).
 * Handlers are pure functions that call DashClawClient and return text content.
 *
 * This file is HAND-CURATED on purpose. Every MCP tool has a semantically
 * precise description and custom handler logic (e.g., dashclaw_wait_for_approval
 * polls until status changes) that can't be auto-generated from route metadata.
 *
 * For the live API surface, see `routes-inventory.generated.json` (regenerated
 * by `npm run livingcode:refresh`). When adding a new route that agents should
 * invoke, diff the inventory against TOOL_DEFINITIONS below to decide whether
 * a new tool wrapper is warranted.
 */

export const TOOL_DEFINITIONS = [
  {
    name: 'dashclaw_guard',
    description:
      'Evaluate DashClaw governance policies before taking a risky action. Call this BEFORE ' +
      'any action that modifies external systems, deploys code, sends messages, or touches ' +
      'production data. Returns a decision: "allow" (proceed), "warn" (proceed with caution), ' +
      '"block" (stop), or "require_approval" (wait for human in Mission Control). If the ' +
      'decision is "block", do NOT proceed with the action.',
    inputSchema: {
      type: 'object',
      properties: {
        action_type: { type: 'string', description: 'Category of action (e.g., deploy, send_email, database_write, api_call)' },
        declared_goal: { type: 'string', description: 'What you intend to do, in plain language' },
        risk_score: { type: 'integer', description: 'Estimated risk 0-100. Use 70+ for production systems.' },
        agent_id: { type: 'string', description: 'Override default agent ID' },
        systems_touched: { type: 'array', items: { type: 'string' }, description: 'Systems affected (e.g., production, database, email)' },
        reversible: { type: 'boolean', description: 'Whether the action can be undone' },
      },
      required: ['action_type', 'declared_goal', 'risk_score'],
    },
  },
  {
    name: 'dashclaw_record',
    description:
      'Record a governed action in DashClaw\'s audit trail. Use this to log significant ' +
      'decisions, completed tasks, or notable outcomes. Every important action the agent takes ' +
      'should be recorded for governance visibility in Mission Control and the Decisions ledger.',
    inputSchema: {
      type: 'object',
      properties: {
        action_type: { type: 'string', description: 'Category (e.g., research, analysis, code_change, deploy)' },
        declared_goal: { type: 'string', description: 'What was accomplished' },
        status: { type: 'string', enum: ['running', 'completed', 'failed', 'pending_approval'], description: 'Outcome status' },
        risk_score: { type: 'integer', description: 'Risk level 0-100 (default 30)' },
        agent_id: { type: 'string', description: 'Override default agent ID' },
        reasoning: { type: 'string', description: 'Why this action was chosen' },
        confidence: { type: 'integer', description: 'Confidence 0-100' },
        systems_touched: { type: 'array', items: { type: 'string' }, description: 'Systems affected' },
        reversible: { type: 'boolean', description: 'Whether the action can be undone' },
        output_summary: { type: 'string', description: 'Brief summary of what was produced' },
        tokens_in: { type: 'integer', description: 'Input tokens consumed' },
        tokens_out: { type: 'integer', description: 'Output tokens produced' },
        model: { type: 'string', description: 'Model used' },
        cost_estimate: { type: 'number', description: 'Estimated cost in USD' },
      },
      required: ['action_type', 'declared_goal', 'status'],
    },
  },
  {
    name: 'dashclaw_invoke',
    description:
      'Invoke a DashClaw-governed capability (external API). The capability is guarded ' +
      '(policy check), executed (HTTP call), and recorded (audit trail) automatically. Use ' +
      'this instead of making direct HTTP calls when the target API is registered as a DashClaw ' +
      'capability. Call dashclaw_capabilities_list first to discover available capability IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        capability_id: { type: 'string', description: 'The capability ID (e.g., cap_abc123)' },
        declared_goal: { type: 'string', description: 'What you\'re trying to accomplish' },
        agent_id: { type: 'string', description: 'Override default agent ID' },
        payload: { type: 'object', description: 'Request payload for the capability' },
      },
      required: ['capability_id', 'declared_goal'],
    },
  },
  {
    name: 'dashclaw_capabilities_list',
    description:
      'List available capabilities registered in DashClaw. Use this to discover what external ' +
      'APIs and tools are available before invoking them. Returns capability IDs, names, health ' +
      'status, and risk levels. Filter by category, risk level, or search term.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category: external_api, webhook, function' },
        risk_level: { type: 'string', description: 'Filter: low, medium, high, critical' },
        search: { type: 'string', description: 'Search by name or description' },
      },
    },
  },
  {
    name: 'dashclaw_policies_list',
    description:
      'List active governance policies. Use this to understand what rules govern your actions ' +
      'before taking them. Helps calibrate risk scores and know which action types require ' +
      'approval. Optionally filter to policies applying to a specific agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Filter to policies applying to a specific agent' },
      },
    },
  },
  {
    name: 'dashclaw_wait_for_approval',
    description:
      'Wait for a human to approve or deny a pending action in DashClaw Mission Control. ' +
      'Call this after a guard decision returns "require_approval" or after recording an ' +
      'action with status "pending_approval". Polls the action status until it changes. ' +
      'Default timeout is 300 seconds (5 minutes).',
    inputSchema: {
      type: 'object',
      properties: {
        action_id: { type: 'string', description: 'The action ID to wait on (e.g., act_abc123)' },
        timeout_seconds: { type: 'number', description: 'Max wait time (default 300)' },
        poll_interval_seconds: { type: 'number', description: 'Polling frequency (default 3)' },
      },
      required: ['action_id'],
    },
  },
  {
    name: 'dashclaw_session_start',
    description:
      'Register this agent session with DashClaw. Creates a session record that groups all ' +
      'subsequent actions for tracking and observability. Call this at the beginning of a task ' +
      'to establish a governance boundary.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent identifier (required)' },
        workspace: { type: 'string', description: 'Workspace or project context' },
        branch: { type: 'string', description: 'Git branch or task branch' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'dashclaw_session_end',
    description:
      'Close a DashClaw session and update its status. Call this when the task is complete ' +
      'or if the session needs to be marked as failed. Provides a clean lifecycle boundary ' +
      'for governance reporting in Mission Control.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID from dashclaw_session_start' },
        status: { type: 'string', enum: ['completed', 'failed', 'cancelled'], description: 'Final session status' },
        summary: { type: 'string', description: 'Brief description of what was accomplished' },
      },
      required: ['session_id', 'status'],
    },
  },
  // --- Code Sessions: Optimal Files (Phase 6) ------------------------------
  {
    name: 'dashclaw_optimal_files_preview',
    description:
      'Preview the Optimal Files bundle DashClaw Code Sessions would generate for a given session. Returns the per-file plan with confidence, secret-scan, and overwrite-risk flags. Read-only — does NOT write to disk; pair with dashclaw_optimal_files_manifest to persist a chosen subset.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Code session id (cs_*) from /api/code-sessions/sessions/...' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'dashclaw_optimal_files_manifest',
    description:
      'Persist a write plan for selected Optimal Files entries. Returns { manifest_id, expires_at, apply_command }. The local CLI invokes `dashclaw code apply <manifest_id>` to apply the plan to disk. Manifest expires after 24h.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Code session id (cs_*)' },
        selections: {
          type: 'array',
          description: 'Subset of paths from the preview to write. Each item: { path, mode?: "skip"|"side_by_side"|"merge"|"overwrite", overwrite?, acceptedHeadings?, acceptedBullets? }',
          items: { type: 'object' },
        },
      },
      required: ['session_id', 'selections'],
    },
  },
  {
    name: 'dashclaw_handoff_create',
    description:
      'Create a session handoff bundle for the next session of this agent to consume on start. ' +
      'Call this when wrapping up — include a 1-2 sentence summary, any open loops, decisions made, ' +
      'and freeform state you want the next session to see.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent ID (override default)' },
        project_id: { type: 'string', description: 'Optional project ID — handoff is project-scoped' },
        bundle: {
          type: 'object',
          description: 'Handoff content: { summary, open_loops, decisions_made, state_snapshot, generated_at }',
        },
      },
      required: ['bundle'],
    },
  },
  {
    name: 'dashclaw_handoff_latest',
    description:
      'Fetch the latest unconsumed session handoff for this agent (+ project, optional). ' +
      'Call this on session start to pick up where the last session left off. Returns null if ' +
      'no handoff is waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        project_id: { type: 'string' },
      },
    },
  },
  {
    name: 'dashclaw_handoff_consume',
    description:
      'Mark a handoff as consumed. Call after dashclaw_handoff_latest returns a bundle and you ' +
      'have processed it. Idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Handoff id (hf_*) from handoff_latest' },
        session_id: { type: 'string', description: 'Optional current session id for provenance' },
      },
      required: ['id'],
    },
  },
  {
    name: 'dashclaw_secret_list',
    description:
      'List tracked secrets (metadata only — no values). Returns each entry with name, rotation ' +
      'interval, last_rotated_at, and computed next_rotation_due.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Optional — scope to this agent' },
      },
    },
  },
  {
    name: 'dashclaw_secret_due',
    description:
      'List secrets coming due for rotation. Call this BEFORE acting on credentials. If a ' +
      'credential you would use is in the result, flag the operator rather than proceeding.',
    inputSchema: {
      type: 'object',
      properties: {
        within_days: { type: 'integer', description: 'Lookahead window in days (default 14)' },
        agent_id: { type: 'string' },
      },
    },
  },
  {
    name: 'dashclaw_secret_mark_rotated',
    description:
      'Mark a tracked secret as rotated (sets last_rotated_at = now). Agents only call this if ' +
      'the operator instructs; secret registration is an operator task.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Secret id (sec_*)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'dashclaw_skill_scan',
    description:
      'Run a static safety scan against the contents of an untrusted skill before loading it. ' +
      'Returns findings (severity, file, line) and a passed boolean. If passed=false, do NOT load ' +
      'the skill — show the findings to the operator.',
    inputSchema: {
      type: 'object',
      properties: {
        skill_name: { type: 'string' },
        files: {
          type: 'object',
          description: 'Map of filename -> file content (string)',
        },
      },
      required: ['skill_name', 'files'],
    },
  },
  {
    name: 'dashclaw_loop_add',
    description:
      'Register an open loop on a parent action — a commitment made in conversation that needs ' +
      'follow-up. Use when you say "I will X later" so the loop is tracked outside of context. ' +
      'Loops are action-scoped; action_id is required.',
    inputSchema: {
      type: 'object',
      properties: {
        action_id: { type: 'string', description: 'Parent action id (act_*) the loop attaches to' },
        loop_type: { type: 'string', description: 'Category (e.g., follow_up, blocker, decision_pending)' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Priority (default medium)' },
        owner: { type: 'string', description: 'Optional owner (agent or human handle)' },
      },
      required: ['action_id', 'loop_type', 'description'],
    },
  },
  {
    name: 'dashclaw_loop_list',
    description:
      'List open (or resolved) loops with optional filters. Use on session start to remember ' +
      'what you promised to follow up on.',
    inputSchema: {
      type: 'object',
      properties: {
        action_id: { type: 'string', description: 'Filter by parent action' },
        status: { type: 'string', enum: ['open', 'resolved', 'cancelled'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        agent_id: { type: 'string', description: 'Filter by agent (joined via parent action)' },
        from: { type: 'string', description: 'ISO timestamp lower bound (reserved)' },
        to: { type: 'string', description: 'ISO timestamp upper bound (reserved)' },
      },
    },
  },
  {
    name: 'dashclaw_loop_close',
    description:
      'Resolve an open loop. Call when the followed-up-on item is complete. Requires the loop_id ' +
      'and a short resolution note.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Loop id (loop_*)' },
        resolution: { type: 'string', description: 'Short note describing how the loop was closed' },
      },
      required: ['id'],
    },
  },
  {
    name: 'dashclaw_learning_log',
    description:
      'Log a decision + outcome to the learning database. Use after making a non-obvious decision ' +
      'so future sessions can recall the reasoning and outcome.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        decision: { type: 'string', description: 'What was decided' },
        context: { type: 'string', description: 'Why this decision was made' },
        outcome: { type: 'string', description: 'What happened (optional, can be updated later)' },
      },
      required: ['decision'],
    },
  },
  {
    name: 'dashclaw_learning_query',
    description:
      'Query the learning database for prior decisions and lessons. Use BEFORE making a decision ' +
      'similar to one you might have made before.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        query: { type: 'string', description: 'Search text (matches decision/context)' },
        limit: { type: 'integer', description: 'Max results (default 10)' },
      },
    },
  },
  {
    name: 'dashclaw_decisions_recent',
    description:
      'Query the guardrail decisions ledger for recent governed actions. Filter by agent, action ' +
      'type, decision verdict, or time window. Use for in-session retrospection — "what have I done ' +
      'recently?"',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        action_type: { type: 'string' },
        decision: { type: 'string', enum: ['allow', 'warn', 'block', 'require_approval'] },
        since: { type: 'string', description: 'ISO timestamp lower bound' },
        limit: { type: 'integer', description: 'Max results (default 20)' },
      },
    },
  },
];

/**
 * Create tool handler functions bound to a DashClawClient instance.
 * Each handler accepts input args and returns a JSON string (MCP text content).
 * @param {import('./client.js').DashClawClient} client
 * @returns {Object<string, function>}
 */
export function createToolHandlers(client) {
  const agentId = (input) => input.agent_id || client.agentId;

  return {
    async dashclaw_optimal_files_preview(input) {
      const result = await client.post(`/api/code-sessions/sessions/${encodeURIComponent(input.session_id)}/optimal-files/preview`, {}, { timeout: 20000 });
      return JSON.stringify(result);
    },

    async dashclaw_optimal_files_manifest(input) {
      const result = await client.post(`/api/code-sessions/sessions/${encodeURIComponent(input.session_id)}/optimal-files/manifest`,
        { selections: input.selections || [] }, { timeout: 20000 });
      return JSON.stringify(result);
    },

    async dashclaw_guard(input) {
      const result = await client.post('/api/guard', {
        action_type: input.action_type,
        declared_goal: input.declared_goal,
        risk_score: input.risk_score,
        agent_id: agentId(input),
        systems_touched: input.systems_touched,
        reversible: input.reversible,
      }, { timeout: 10000 });
      return JSON.stringify(result);
    },

    async dashclaw_record(input) {
      const body = {
        action_type: input.action_type,
        declared_goal: input.declared_goal,
        status: input.status,
        risk_score: input.risk_score ?? 30,
        agent_id: agentId(input),
        reasoning: input.reasoning,
        confidence: input.confidence,
        systems_touched: input.systems_touched,
        reversible: input.reversible,
        output_summary: input.output_summary,
        tokens_in: input.tokens_in,
        tokens_out: input.tokens_out,
        model: input.model,
        cost_estimate: input.cost_estimate,
      };
      const result = await client.post('/api/actions', body, { timeout: 10000 });
      return JSON.stringify(result);
    },

    async dashclaw_invoke(input) {
      const result = await client.post(`/api/capabilities/${input.capability_id}/invoke`, {
        agent_id: agentId(input),
        declared_goal: input.declared_goal,
        payload: input.payload,
      }, { timeout: 30000 });
      return JSON.stringify(result);
    },

    async dashclaw_capabilities_list(input) {
      const result = await client.get('/api/capabilities', {
        category: input.category,
        risk_level: input.risk_level,
        search: input.search,
      }, { timeout: 10000 });
      return JSON.stringify(result);
    },

    async dashclaw_policies_list(input) {
      const result = await client.get('/api/policies', {
        agent_id: input.agent_id,
      }, { timeout: 10000 });
      return JSON.stringify(result);
    },

    async dashclaw_wait_for_approval(input) {
      const timeout = (input.timeout_seconds ?? 300) * 1000;
      const interval = (input.poll_interval_seconds ?? 3) * 1000;
      const start = Date.now();

      while (Date.now() - start < timeout) {
        const result = await client.get(`/api/actions/${input.action_id}`, {}, { timeout: 10000 });
        const status = result?.action?.status;

        if (status && status !== 'pending_approval') {
          const approved = status === 'completed';
          // Distinguish explicit operator denial (failed/cancelled) from
          // a genuine approval. The JS and Python SDKs throw on denial;
          // MCP can't throw through the tool channel, so surface a
          // clear `denied:true` + reason instead of returning
          // approved:false with no further signal.
          const denied = !approved && (status === 'failed' || status === 'cancelled');
          return JSON.stringify({
            approved,
            denied,
            denial_reason: denied
              ? (result?.action?.error_message || `Operator marked action as ${status}`)
              : null,
            action: result.action,
            waited_seconds: Math.round((Date.now() - start) / 1000),
          });
        }

        await new Promise((r) => setTimeout(r, interval));
      }

      return JSON.stringify({
        approved: false,
        timed_out: true,
        action: { status: 'pending_approval' },
        waited_seconds: Math.round((Date.now() - start) / 1000),
      });
    },

    async dashclaw_session_start(input) {
      const result = await client.post('/api/sessions', {
        agent_id: input.agent_id,
        workspace: input.workspace,
        branch: input.branch,
      }, { timeout: 10000 });
      return JSON.stringify(result);
    },

    async dashclaw_session_end(input) {
      const result = await client.patch(`/api/sessions/${input.session_id}`, {
        status: input.status,
        summary: input.summary,
      }, { timeout: 10000 });
      return JSON.stringify(result);
    },

    async dashclaw_handoff_create(args) {
      const res = await client.fetch('/api/handoffs', {
        method: 'POST',
        body: JSON.stringify({
          agent_id: agentId(args),
          project_id: args.project_id,
          bundle: args.bundle,
        }),
      });
      return res.json();
    },

    async dashclaw_handoff_latest(args) {
      const params = new URLSearchParams();
      const aid = agentId(args);
      if (aid) params.set('agent_id', aid);
      if (args.project_id) params.set('project_id', args.project_id);
      const res = await client.fetch(`/api/handoffs/latest?${params}`);
      if (res.status === 404) return null;
      return res.json();
    },

    async dashclaw_handoff_consume(args) {
      const res = await client.fetch(`/api/handoffs/${encodeURIComponent(args.id)}/consume`, {
        method: 'POST',
        body: JSON.stringify({ session_id: args.session_id }),
      });
      return res.json();
    },

    async dashclaw_secret_list(args) {
      const params = new URLSearchParams();
      const aid = agentId(args);
      if (aid) params.set('agent_id', aid);
      const res = await client.fetch(`/api/secrets?${params}`);
      return res.json();
    },

    async dashclaw_secret_due(args) {
      const params = new URLSearchParams();
      if (args.within_days != null) params.set('within_days', String(args.within_days));
      const aid = agentId(args);
      if (aid) params.set('agent_id', aid);
      const res = await client.fetch(`/api/secrets/rotation-due?${params}`);
      return res.json();
    },

    async dashclaw_secret_mark_rotated(args) {
      const res = await client.fetch(`/api/secrets/${encodeURIComponent(args.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ last_rotated_at: new Date().toISOString() }),
      });
      return res.json();
    },

    async dashclaw_skill_scan(args) {
      const res = await client.fetch('/api/skills/scan', {
        method: 'POST',
        body: JSON.stringify({
          skill_name: args.skill_name,
          files: args.files,
        }),
      });
      return res.json();
    },

    async dashclaw_loop_add(args) {
      const res = await client.fetch('/api/actions/loops', {
        method: 'POST',
        body: JSON.stringify({
          action_id: args.action_id,
          loop_type: args.loop_type,
          description: args.description,
          priority: args.priority,
          owner: args.owner,
        }),
      });
      return res.json();
    },

    async dashclaw_loop_list(args) {
      const params = new URLSearchParams();
      if (args.action_id) params.set('action_id', args.action_id);
      if (args.status) params.set('status', args.status);
      if (args.priority) params.set('priority', args.priority);
      const aid = agentId(args);
      if (aid) params.set('agent_id', aid);
      if (args.from) params.set('from', args.from);
      if (args.to) params.set('to', args.to);
      const res = await client.fetch(`/api/actions/loops?${params}`);
      return res.json();
    },

    async dashclaw_loop_close(args) {
      const res = await client.fetch(`/api/actions/loops/${encodeURIComponent(args.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'resolved',
          resolution: args.resolution || 'Closed by agent via dashclaw_loop_close',
        }),
      });
      return res.json();
    },

    async dashclaw_learning_log(args) {
      const res = await client.fetch('/api/learning', {
        method: 'POST',
        body: JSON.stringify({
          agent_id: agentId(args),
          decision: args.decision,
          context: args.context,
          outcome: args.outcome,
        }),
      });
      return res.json();
    },

    async dashclaw_learning_query(args) {
      const params = new URLSearchParams();
      const aid = agentId(args);
      if (aid) params.set('agent_id', aid);
      if (args.query) params.set('q', args.query);
      if (args.limit) params.set('limit', String(args.limit));
      const res = await client.fetch(`/api/learning/lessons?${params}`);
      return res.json();
    },

    async dashclaw_decisions_recent(args) {
      const params = new URLSearchParams();
      const aid = agentId(args);
      if (aid) params.set('agent_id', aid);
      if (args.action_type) params.set('action_type', args.action_type);
      if (args.decision) params.set('decision', args.decision);
      if (args.since) params.set('since', args.since);
      if (args.limit) params.set('limit', String(args.limit));
      const res = await client.fetch(`/api/guard/decisions?${params}`);
      return res.json();
    },
  };
}
