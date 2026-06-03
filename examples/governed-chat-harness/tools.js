/**
 * Example tool registry for the governed chat harness.
 *
 * Each entry has three parts:
 *   definition  the Anthropic tool schema sent to the model
 *   governance  optional overrides for classifyTool (action_type, risk_score, ...)
 *   run         async (input) => string, the actual side effect
 *
 * The harness governs and records EVERY entry here automatically. To add a real
 * capability (an MCP method, a DashClaw capability, a database write), add an
 * entry with an honest governance block and a run function. See the sketches
 * at the bottom of this file.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const NOTES_DIR = path.join(process.cwd(), 'notes');

export const tools = {
  calculator: {
    definition: {
      name: 'calculator',
      description: 'Evaluate a basic arithmetic expression and return the result.',
      input_schema: {
        type: 'object',
        properties: { expression: { type: 'string', description: 'e.g. (3 + 4) * 2' } },
        required: ['expression'],
      },
    },
    governance: { action_type: 'review', risk_score: 5, reversible: true },
    run: async ({ expression }) => {
      if (!/^[0-9+\-*/().\s]+$/.test(expression || '')) {
        return JSON.stringify({ error: 'Only numbers and + - * / ( ) are allowed.' });
      }
      try {
        const result = Function(`"use strict"; return (${expression});`)();
        return JSON.stringify({ expression, result });
      } catch (err) {
        return JSON.stringify({ error: String(err.message || err) });
      }
    },
  },

  web_fetch: {
    definition: {
      name: 'web_fetch',
      description: 'Fetch the text content at a public https URL (read only).',
      input_schema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Absolute https URL' } },
        required: ['url'],
      },
    },
    governance: { action_type: 'api', risk_score: 30, reversible: true, systems_touched: ['network'] },
    run: async ({ url }) => {
      try {
        const res = await fetch(url, { redirect: 'follow' });
        const text = await res.text();
        return JSON.stringify({ url, status: res.status, body: text.slice(0, 4000) });
      } catch (err) {
        return JSON.stringify({ error: String(err.message || err) });
      }
    },
  },

  write_note: {
    definition: {
      name: 'write_note',
      description: 'Save a short text note to the local notes folder.',
      input_schema: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'e.g. ideas.txt' },
          content: { type: 'string' },
        },
        required: ['filename', 'content'],
      },
    },
    governance: { action_type: 'apply', risk_score: 25, reversible: true, systems_touched: ['filesystem'] },
    run: async ({ filename, content }) => {
      const safe = path.basename(filename || 'note.txt');
      const dest = path.join(NOTES_DIR, safe);
      await fs.mkdir(NOTES_DIR, { recursive: true });
      await fs.writeFile(dest, content ?? '', 'utf8');
      return JSON.stringify({ saved: dest, bytes: Buffer.byteLength(content ?? '') });
    },
  },
};

// ---------------------------------------------------------------------------
// Adding an MCP backed tool (sketch):
//
//   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
//   const mcp = /* connect your MCP client to your server */;
//   tools['mcp__gmail__send'] = {
//     definition: { name: 'mcp__gmail__send', description: '...', input_schema: {...} },
//     governance: { action_type: 'message', risk_score: 70, reversible: false },
//     run: async (input) => JSON.stringify(await mcp.callTool({ name: 'send', arguments: input })),
//   };
//
// Naming a tool with the mcp__ prefix makes classifyTool treat it as an
// external call by default, matching the hook convention.
//
// Routing through a registered DashClaw capability instead (inner call is
// guarded and recorded server side as well):
//
//   run: async (input) => JSON.stringify(await claw.invokeCapability('cap_abc123', input))
// ---------------------------------------------------------------------------

export function toolDefinitions() {
  return Object.values(tools).map((t) => t.definition);
}
