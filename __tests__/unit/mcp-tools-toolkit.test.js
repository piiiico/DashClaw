import { describe, it, expect } from 'vitest';
import { TOOL_DEFINITIONS, createToolHandlers } from '../../mcp-server/lib/tools.js';

const NEW_TOOLS = [
  'dashclaw_handoff_create',
  'dashclaw_handoff_latest',
  'dashclaw_handoff_consume',
  'dashclaw_secret_list',
  'dashclaw_secret_due',
  'dashclaw_secret_mark_rotated',
  'dashclaw_skill_scan',
  'dashclaw_loop_add',
  'dashclaw_loop_list',
  'dashclaw_loop_close',
  'dashclaw_learning_log',
  'dashclaw_learning_query',
  'dashclaw_decisions_recent',
];

describe('MCP toolkit tools', () => {
  it('all 13 new toolkit tools are defined', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    for (const tool of NEW_TOOLS) {
      expect(names).toContain(tool);
    }
  });

  it('every new tool has description, inputSchema with type=object', () => {
    for (const name of NEW_TOOLS) {
      const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('every new tool has a handler', () => {
    const client = {
      fetch: async () => ({ ok: true, json: async () => ({}) }),
    };
    const handlers = createToolHandlers(client);
    for (const name of NEW_TOOLS) {
      expect(typeof handlers[name]).toBe('function');
    }
  });

  it('handoff_create handler POSTs /api/handoffs', async () => {
    let captured = null;
    const client = {
      fetch: async (path, opts) => {
        captured = { path, body: opts?.body };
        return { ok: true, json: async () => ({ id: 'hf_1' }) };
      },
    };
    const handlers = createToolHandlers(client);
    await handlers.dashclaw_handoff_create({ agent_id: 'hermes', bundle: { summary: 's' } });
    expect(captured.path).toMatch(/\/api\/handoffs$/);
  });

  it('handoff_latest handler GETs /api/handoffs/latest', async () => {
    let captured = null;
    const client = {
      fetch: async (path) => {
        captured = path;
        return { ok: true, json: async () => ({ id: 'hf_1' }) };
      },
    };
    const handlers = createToolHandlers(client);
    await handlers.dashclaw_handoff_latest({ agent_id: 'hermes' });
    expect(captured).toMatch(/\/api\/handoffs\/latest/);
  });

  it('skill_scan handler POSTs /api/skills/scan with skill_name + files', async () => {
    let captured = null;
    const client = {
      fetch: async (path, opts) => {
        captured = { path, body: JSON.parse(opts.body) };
        return { ok: true, json: async () => ({ id: 'scn_1', passed: true }) };
      },
    };
    const handlers = createToolHandlers(client);
    await handlers.dashclaw_skill_scan({ skill_name: 'test', files: { 'a.py': 'print(1)' } });
    expect(captured.path).toMatch(/\/api\/skills\/scan/);
    expect(captured.body.skill_name).toBe('test');
  });

  it('decisions_recent handler builds query params', async () => {
    let captured = null;
    const client = {
      fetch: async (path) => {
        captured = path;
        return { ok: true, json: async () => ({ decisions: [] }) };
      },
    };
    const handlers = createToolHandlers(client);
    await handlers.dashclaw_decisions_recent({ agent_id: 'hermes', action_type: 'deploy', limit: 10 });
    expect(captured).toMatch(/agent_id=hermes/);
    expect(captured).toMatch(/action_type=deploy/);
    expect(captured).toMatch(/limit=10/);
  });
});
