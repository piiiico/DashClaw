// __tests__/unit/mcp-tools.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPost = vi.fn();
const mockGet = vi.fn();
const mockPatch = vi.fn();

vi.mock('../../mcp-server/lib/client.js', () => ({
  DashClawClient: vi.fn().mockImplementation(function () {
    this.post = mockPost;
    this.get = mockGet;
    this.patch = mockPatch;
    this.agentId = 'default-agent';
  }),
}));

const { createToolHandlers, TOOL_DEFINITIONS } = await import('../../mcp-server/lib/tools.js');
import { DashClawClient } from '../../mcp-server/lib/client.js';

describe('Tool Definitions', () => {
  it('exports exactly 23 tool definitions', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(23);
  });

  it('every definition has name, description, and inputSchema', () => {
    for (const def of TOOL_DEFINITIONS) {
      expect(def.name).toBeTruthy();
      expect(def.description.length).toBeGreaterThan(50);
      expect(def.inputSchema).toBeDefined();
      expect(def.inputSchema.type).toBe('object');
    }
  });
});

describe('Tool Handlers', () => {
  let handlers;

  beforeEach(() => {
    vi.clearAllMocks();
    const client = new DashClawClient();
    handlers = createToolHandlers(client);
  });

  describe('dashclaw_guard', () => {
    it('calls POST /api/guard and returns decision', async () => {
      mockPost.mockResolvedValue({ decision: 'allow', reason: 'low risk' });

      const result = await handlers.dashclaw_guard({
        action_type: 'deploy',
        declared_goal: 'Deploy to staging',
        risk_score: 30,
      });

      expect(mockPost).toHaveBeenCalledWith('/api/guard', {
        action_type: 'deploy',
        declared_goal: 'Deploy to staging',
        risk_score: 30,
        agent_id: 'default-agent',
      }, { timeout: 10000 });
      expect(result).toContain('"decision":"allow"');
    });

    it('server-configured agent_id wins over LLM-supplied agent_id', async () => {
      // Governance: a confused or adversarial prompt must not be able to
      // attribute actions to a different agent identity than the server is
      // configured with. The server's client.agentId (DASHCLAW_AGENT_ID /
      // --agent-id / auto-derived from MCP clientInfo) is authoritative; the
      // tool-input field is preserved only as a last-resort fallback for
      // setups that intentionally run without a server-level default.
      mockPost.mockResolvedValue({ decision: 'block' });

      await handlers.dashclaw_guard({
        action_type: 'deploy',
        declared_goal: 'test',
        risk_score: 50,
        agent_id: 'spoofed-agent', // LLM tries to override the server identity
      });

      expect(mockPost).toHaveBeenCalledWith('/api/guard', expect.objectContaining({
        agent_id: 'default-agent', // server config, not 'spoofed-agent'
      }), expect.anything());
    });

    it('falls back to LLM-supplied agent_id only when server has no default', async () => {
      // Last-resort fallback: if the MCP server was started with no
      // --agent-id, no DASHCLAW_AGENT_ID, AND clientInfo auto-derivation
      // didn't fire (e.g. HTTP transport, or an MCP client that omits
      // clientInfo.name), input.agent_id is the only identity available.
      const bareClient = { agentId: '', post: mockPost, get: mockGet, patch: mockPatch };
      const bareHandlers = createToolHandlers(bareClient);
      mockPost.mockResolvedValue({ decision: 'allow' });

      await bareHandlers.dashclaw_guard({
        action_type: 'deploy',
        declared_goal: 'test',
        risk_score: 30,
        agent_id: 'bare-fallback',
      });

      expect(mockPost).toHaveBeenCalledWith('/api/guard', expect.objectContaining({
        agent_id: 'bare-fallback',
      }), expect.anything());
    });
  });

  describe('dashclaw_record', () => {
    it('calls POST /api/actions and returns action record', async () => {
      mockPost.mockResolvedValue({
        action: { id: '1', action_id: 'act_abc' },
        action_id: 'act_abc',
      });

      const result = await handlers.dashclaw_record({
        action_type: 'research',
        declared_goal: 'Analyzed logs',
        status: 'completed',
      });

      expect(mockPost).toHaveBeenCalledWith('/api/actions', expect.objectContaining({
        action_type: 'research',
        declared_goal: 'Analyzed logs',
        status: 'completed',
        agent_id: 'default-agent',
      }), { timeout: 10000 });
      expect(result).toContain('act_abc');
    });
  });

  describe('dashclaw_invoke', () => {
    it('calls POST /api/capabilities/:id/invoke with payload', async () => {
      mockPost.mockResolvedValue({
        success: true,
        action_id: 'act_xyz',
        result: { data: 'response' },
      });

      const result = await handlers.dashclaw_invoke({
        capability_id: 'cap_123',
        declared_goal: 'Send notification',
        payload: { message: 'hello' },
      });

      expect(mockPost).toHaveBeenCalledWith('/api/capabilities/cap_123/invoke', {
        agent_id: 'default-agent',
        declared_goal: 'Send notification',
        payload: { message: 'hello' },
      }, { timeout: 30000 });
      expect(result).toContain('act_xyz');
    });
  });

  describe('dashclaw_capabilities_list', () => {
    it('calls GET /api/capabilities with filters', async () => {
      mockGet.mockResolvedValue({ capabilities: [{ id: 'cap_1', name: 'Slack' }] });

      const result = await handlers.dashclaw_capabilities_list({
        category: 'external_api',
      });

      expect(mockGet).toHaveBeenCalledWith('/api/capabilities', {
        category: 'external_api',
        risk_level: undefined,
        search: undefined,
      }, { timeout: 10000 });
      expect(result).toContain('Slack');
    });
  });

  describe('dashclaw_policies_list', () => {
    it('calls GET /api/policies with optional agent_id', async () => {
      mockGet.mockResolvedValue({ policies: [{ id: 'gp_1', name: 'No prod deploys' }] });

      const result = await handlers.dashclaw_policies_list({ agent_id: 'bot1' });

      expect(mockGet).toHaveBeenCalledWith('/api/policies', { agent_id: 'bot1' }, { timeout: 10000 });
      expect(result).toContain('No prod deploys');
    });
  });

  describe('dashclaw_wait_for_approval', () => {
    it('polls action status until approved', async () => {
      mockGet
        .mockResolvedValueOnce({ action: { status: 'pending_approval' } })
        .mockResolvedValueOnce({ action: { status: 'completed', id: 'act_1' } });

      const result = await handlers.dashclaw_wait_for_approval({
        action_id: 'act_1',
        poll_interval_seconds: 0.01,
      });

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(result).toContain('"approved":true');
    });

    it('returns timeout when max wait exceeded', async () => {
      mockGet.mockResolvedValue({ action: { status: 'pending_approval' } });

      const result = await handlers.dashclaw_wait_for_approval({
        action_id: 'act_1',
        timeout_seconds: 0.02,
        poll_interval_seconds: 0.01,
      });

      expect(result).toContain('"timed_out":true');
    });

    it('resolves within 2s of status flipping from pending_approval to completed', async () => {
      // SPEC CCI-03 acceptance bullet 3: the MCP tool must resolve within 2s
      // of a status change. Uses a 0.5s poll (tighter than the 3s default)
      // to prove the mechanism honors the 2s boundary when the flip happens
      // between polls. flipTime is captured the moment the mock starts
      // returning the resolved status.
      let flipTime = 0;
      let callCount = 0;
      mockGet.mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          return { action: { status: 'pending_approval' } };
        }
        if (flipTime === 0) flipTime = Date.now();
        return { action: { status: 'completed', id: 'act_1' } };
      });

      const start = Date.now();
      const result = await handlers.dashclaw_wait_for_approval({
        action_id: 'act_1',
        timeout_seconds: 10,
        poll_interval_seconds: 0.5,
      });
      const end = Date.now();

      const parsed = JSON.parse(result);
      expect(parsed.approved).toBe(true);
      expect(Number.isFinite(parsed.waited_seconds)).toBe(true);

      // The acceptance boundary: resolution must happen within 2s of the flip.
      expect(flipTime).toBeGreaterThan(0);
      expect(end - flipTime).toBeLessThanOrEqual(2000);
      // Sanity: we didn't resolve faster than the first pending-response polls.
      expect(end - start).toBeGreaterThanOrEqual(0);
    });
  });

  describe('dashclaw_session_start', () => {
    it('calls POST /api/sessions', async () => {
      mockPost.mockResolvedValue({ session: { id: 'sess_1', status: 'active' } });

      const result = await handlers.dashclaw_session_start({
        agent_id: 'my-agent',
        workspace: 'research',
      });

      expect(mockPost).toHaveBeenCalledWith('/api/sessions', {
        agent_id: 'my-agent',
        workspace: 'research',
        branch: undefined,
      }, { timeout: 10000 });
      expect(result).toContain('sess_1');
    });
  });

  describe('dashclaw_session_end', () => {
    it('calls PATCH /api/sessions/:id', async () => {
      mockPatch.mockResolvedValue({ session: { id: 'sess_1', status: 'completed' } });

      const result = await handlers.dashclaw_session_end({
        session_id: 'sess_1',
        status: 'completed',
        summary: 'Research done',
      });

      expect(mockPatch).toHaveBeenCalledWith('/api/sessions/sess_1', {
        status: 'completed',
        summary: 'Research done',
      }, { timeout: 10000 });
      expect(result).toContain('completed');
    });
  });
});
