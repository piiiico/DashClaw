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
import dns from 'node:dns/promises';
import net from 'node:net';

const NOTES_DIR = path.join(process.cwd(), 'notes');

// --- SSRF guard for web_fetch -------------------------------------------------
// A tool that fetches a model-supplied URL is a classic SSRF sink: left
// unguarded it can reach cloud metadata endpoints (169.254.169.254), localhost
// admin ports, or RFC 1918 hosts. DashClaw's policy layer can gate this call,
// but defense-in-depth means validating the URL too. This is the pattern to
// copy: https-only, resolve the host and reject private/loopback ranges, and
// re-check every redirect hop.
function isBlockedAddress(ip) {
  let addr = (ip || '').toLowerCase();
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped IPv6
  if (mapped) addr = mapped[1];
  if (net.isIPv4(addr)) {
    const [a, b] = addr.split('.').map(Number);
    return (
      a === 0 || a === 127 ||                 // this-host / loopback
      a === 10 ||                             // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) ||    // 172.16.0.0/12
      (a === 192 && b === 168) ||             // 192.168.0.0/16
      (a === 169 && b === 254)                // 169.254.0.0/16 link-local (cloud metadata)
    );
  }
  return (
    addr === '::1' || addr === '::' ||
    addr.startsWith('fc') || addr.startsWith('fd') || // fc00::/7 unique-local
    addr.startsWith('fe80')                           // link-local
  );
}

async function assertSafeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'https:') throw new Error('Only https URLs are allowed');
  const resolved = await dns.lookup(u.hostname, { all: true });
  if (resolved.some((r) => isBlockedAddress(r.address))) {
    throw new Error('URL resolves to a private, loopback, or link-local address');
  }
  return u;
}

// Follow redirects manually so each hop is re-validated (a public URL can 30x
// to an internal one). fetch() re-resolves DNS itself, so this is not a hard
// guarantee against DNS rebinding — but it is the right shape for an example.
async function safeFetch(raw, maxRedirects = 3) {
  let url = (await assertSafeUrl(raw)).toString();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(url, { redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return res;
    url = (await assertSafeUrl(new URL(location, url).toString())).toString();
  }
  throw new Error('Too many redirects');
}

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
        const res = await safeFetch(url);
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
