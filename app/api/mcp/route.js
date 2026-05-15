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
 * Resolve config from request headers.
 * The x-api-key header is already validated by middleware.
 * The route calls back into its own instance's API via localhost.
 */
function resolveConfig(request) {
  const apiKey = request.headers.get('x-api-key') || '';
  const origin = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.DASHCLAW_URL || 'http://localhost:3000';
  return { url: origin, apiKey };
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
        return jsonrpc(id, {
          protocolVersion: PROTOCOL_VERSION,
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
