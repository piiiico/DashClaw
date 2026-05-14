import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const mockPost = vi.fn();
const mockGet = vi.fn();
const mockPatch = vi.fn();

vi.mock('../../mcp-server/lib/client.js', () => ({
  DashClawClient: vi.fn(function () {
    this.post = mockPost;
    this.get = mockGet;
    this.patch = mockPatch;
    this.agentId = '';
  }),
}));

const { POST } = await import('../../app/api/mcp/route.js');

describe('POST /api/mcp', () => {
  beforeEach(() => vi.clearAllMocks());

  it('handles initialize request', async () => {
    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test', 'content-type': 'application/json' },
      body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {} } },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.jsonrpc).toBe('2.0');
    expect(data.id).toBe(1);
    expect(data.result.serverInfo.name).toBe('@dashclaw/mcp-server');
    expect(data.result.capabilities.tools).toBeDefined();
    expect(data.result.capabilities.resources).toBeDefined();
  });

  it('handles notifications/initialized request', async () => {
    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: { jsonrpc: '2.0', id: null, method: 'notifications/initialized', params: {} },
    });

    const res = await POST(request);

    // JSON-RPC 2.0: notifications must not receive a response body.
    expect(res.status).toBe(204);
  });

  it('handles tools/list request', async () => {
    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.result.tools).toHaveLength(23);
    expect(data.result.tools.map(t => t.name)).toContain('dashclaw_guard');
    expect(data.result.tools[0].inputSchema).toBeDefined();
  });

  it('handles tools/call for dashclaw_guard', async () => {
    mockPost.mockResolvedValue({ decision: 'allow', reason: 'low risk' });

    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'dashclaw_guard',
          arguments: { action_type: 'deploy', declared_goal: 'test', risk_score: 20 },
        },
      },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.result.content[0].type).toBe('text');
    expect(JSON.parse(data.result.content[0].text).decision).toBe('allow');
  });

  it('returns error for unknown tool in tools/call', async () => {
    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: {
        jsonrpc: '2.0', id: 99, method: 'tools/call',
        params: { name: 'unknown_tool', arguments: {} },
      },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.error.code).toBe(-32602);
  });

  it('handles resources/list request', async () => {
    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: { jsonrpc: '2.0', id: 4, method: 'resources/list', params: {} },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.result.resources.length).toBeGreaterThanOrEqual(3);
    expect(data.result.resourceTemplates).toBeDefined();
  });

  it('handles resources/read for dashclaw://policies', async () => {
    mockGet.mockResolvedValue({ policies: [{ id: 'gp_1' }] });

    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: { jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'dashclaw://policies' } },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.result.contents[0].uri).toBe('dashclaw://policies');
    expect(JSON.parse(data.result.contents[0].text).policies).toHaveLength(1);
  });

  it('handles resources/read for agent history template', async () => {
    mockGet.mockResolvedValue({ actions: [{ id: 'act_1' }] });

    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: {
        jsonrpc: '2.0', id: 6, method: 'resources/read',
        params: { uri: 'dashclaw://agent/agent_abc/history' },
      },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.result.contents[0].uri).toBe('dashclaw://agent/agent_abc/history');
    expect(mockGet).toHaveBeenCalledWith('/api/actions', { agent_id: 'agent_abc', limit: '50' }, expect.any(Object));
  });

  it('returns error for unknown resource in resources/read', async () => {
    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: {
        jsonrpc: '2.0', id: 7, method: 'resources/read',
        params: { uri: 'dashclaw://unknown' },
      },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.error.code).toBe(-32602);
  });

  it('handles ping request', async () => {
    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: { jsonrpc: '2.0', id: 8, method: 'ping', params: {} },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.result).toEqual({});
  });

  it('returns method not found for unknown methods', async () => {
    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: { jsonrpc: '2.0', id: 6, method: 'unknown/method', params: {} },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.error.code).toBe(-32601);
  });
});
