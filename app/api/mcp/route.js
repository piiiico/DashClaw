export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { DashClawClient } from '../../../mcp-server/lib/client.js';
import { TOOL_DEFINITIONS, createToolHandlers } from '../../../mcp-server/lib/tools.js';
import { RESOURCE_DEFINITIONS, createResourceHandlers } from '../../../mcp-server/lib/resources.js';
// Single source of truth for the MCP server version — never hardcode here.
import mcpServerPkg from '../../../mcp-server/package.json' with { type: 'json' };

const SERVER_INFO = {
  name: '@dashclaw/mcp-server',
  version: mcpServerPkg.version,
};

const PROTOCOL_VERSION = '2025-03-26';

function jsonrpc(id, result) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}

function jsonrpcError(id, code, message) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } });
}

/**
 * Resolve the origin this route calls back into for its own instance's API.
 * Uses an explicit DASHCLAW_URL, else the public Host the caller connected through.
 * MUST NOT use VERCEL_URL: that is the per-deployment URL (my-dashclaw-<hash>…
 * .vercel.app), which sits behind Vercel deployment protection and answers
 * server-side fetches with an HTML SSO page — every tool call then fails with
 * "HTML instead of JSON". The public production alias (the Host) is not walled.
 */
function instanceOrigin(request) {
  if (process.env.DASHCLAW_URL) return process.env.DASHCLAW_URL.replace(/\/$/, '');
  const host = request.headers.get('host');
  if (host) {
    const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
    const proto = request.headers.get('x-forwarded-proto') || (isLocal ? 'http' : 'https');
    return `${proto}://${host}`;
  }
  return 'http://localhost:3000';
}

/**
 * Resolve config from request headers.
 * The x-api-key header (or Bearer Authorization) is already validated by middleware.
 */
function resolveConfig(request) {
  const apiKey = request.headers.get('x-api-key') || '';
  const authHeader = request.headers.get('authorization') || '';
  return { url: instanceOrigin(request), apiKey, authHeader };
}

/**
 * POST /api/mcp — Streamable HTTP transport for the MCP protocol.
 * Implements JSON-RPC 2.0 directly (no MCP SDK transport layer).
 * Middleware handles auth; route is stateless per-request.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { id, method, params } = body;

    const config = resolveConfig(request);
    const client = new DashClawClient(config);
    const toolHandlers = createToolHandlers(client);
    const resourceHandlers = createResourceHandlers(client);

    switch (method) {
      case 'initialize':
        // Echo the client's requested protocol version so newer remote clients
        // (e.g. Claude Desktop sends 2025-11-25) accept the handshake instead of
        // rejecting an older server-declared version. Falls back to ours.
        return jsonrpc(id, {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          serverInfo: SERVER_INFO,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
        });

      case 'notifications/initialized':
        // JSON-RPC 2.0: notifications carry no id and MUST NOT receive a
        // response body. Returning a jsonrpc result frame here is a
        // protocol violation that strict clients (Cursor, some Desktop
        // builds) flag as an unexpected message. 204 No Content is
        // equivalent to "acknowledged with nothing to say".
        return new Response(null, { status: 204 });

      case 'tools/list':
        return jsonrpc(id, {
          tools: TOOL_DEFINITIONS.map((def) => ({
            name: def.name,
            description: def.description,
            inputSchema: def.inputSchema,
          })),
        });

      case 'tools/call': {
        const { name, arguments: args } = params;
        const handler = toolHandlers[name];
        if (!handler) {
          return jsonrpcError(id, -32602, `Unknown tool: ${name}`);
        }
        const text = await handler(args || {});
        return jsonrpc(id, {
          content: [{ type: 'text', text }],
        });
      }

      case 'resources/list':
        return jsonrpc(id, {
          resources: RESOURCE_DEFINITIONS.filter((d) => !d.isTemplate).map((def) => ({
            uri: def.uri,
            name: def.name,
            description: def.description,
            mimeType: def.mimeType,
          })),
          resourceTemplates: RESOURCE_DEFINITIONS.filter((d) => d.isTemplate).map((def) => ({
            uriTemplate: def.uri,
            name: def.name,
            description: def.description,
            mimeType: def.mimeType,
          })),
        });

      case 'resources/read': {
        const { uri } = params;
        // Match static resources
        const staticHandler = resourceHandlers[uri];
        if (staticHandler) {
          const text = await staticHandler();
          return jsonrpc(id, { contents: [{ uri, text }] });
        }
        // Match template: dashclaw://agent/{agent_id}/history
        const historyMatch = uri.match(/^dashclaw:\/\/agent\/([^/]+)\/history$/);
        if (historyMatch) {
          const text = await resourceHandlers['dashclaw://agent/{agent_id}/history']({ agent_id: historyMatch[1] });
          return jsonrpc(id, { contents: [{ uri, text }] });
        }
        return jsonrpcError(id, -32602, `Unknown resource: ${uri}`);
      }

      case 'ping':
        return jsonrpc(id, {});

      default:
        return jsonrpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    console.error('MCP route error:', err);
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } },
      { status: 500 },
    );
  }
}
