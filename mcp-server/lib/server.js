// mcp-server/lib/server.js

/**
 * Factory function that creates a configured McpServer with all tools and resources registered.
 *
 * Uses @modelcontextprotocol/server v2 alpha API:
 * - registerTool(name, config, handler) — config.inputSchema accepts Standard Schema (via fromJsonSchema)
 * - registerResource(name, uri, config, readCallback) — static resources
 * - registerResource(name, ResourceTemplate, config, readCallback) — URI template resources
 */

import { createRequire } from 'module';
import { McpServer, ResourceTemplate, fromJsonSchema } from '@modelcontextprotocol/server';
import { DashClawClient } from './client.js';
import { TOOL_DEFINITIONS, createToolHandlers } from './tools.js';
import { RESOURCE_DEFINITIONS, createResourceHandlers } from './resources.js';

const { version } = createRequire(import.meta.url)('../package.json');

/**
 * Convert a JSON Schema object to a Standard Schema wrapper accepted by registerTool.
 * Uses fromJsonSchema from the MCP SDK which wraps the schema with a validator.
 *
 * @param {object} jsonSchema - JSON Schema object
 * @returns {object} Standard Schema wrapper
 */
function jsonSchemaToInputSchema(jsonSchema) {
  return fromJsonSchema(jsonSchema);
}

/**
 * Create and configure an McpServer instance with all tools and resources from
 * TOOL_DEFINITIONS and RESOURCE_DEFINITIONS.
 *
 * @param {object} config - Configuration options
 * @param {string} [config.url] - DashClaw instance URL (default: http://localhost:3000)
 * @param {string} [config.apiKey] - API key (oc_live_ prefix)
 * @param {string} [config.agentId] - Default agent ID for tool calls
 * @returns {{ server: McpServer, client: DashClawClient }} Configured MCP server
 *   ready to connect, plus the DashClawClient so callers (the stdio bin) can
 *   auto-derive `agentId` from the MCP initialize handshake when no
 *   --agent-id / DASHCLAW_AGENT_ID was provided.
 */
export function createServer(config = {}) {
  // 1. Create DashClawClient
  const client = new DashClawClient({
    url: config.url,
    apiKey: config.apiKey,
    agentId: config.agentId,
  });

  // 2. Create tool and resource handlers bound to the client
  const toolHandlers = createToolHandlers(client);
  const resourceHandlers = createResourceHandlers(client);

  // 3. Create McpServer instance
  const server = new McpServer(
    {
      name: '@dashclaw/mcp-server',
      version,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // 4. Register all tools
  for (const toolDef of TOOL_DEFINITIONS) {
    const handler = toolHandlers[toolDef.name];
    if (!handler) {
      throw new Error(`Missing handler for tool: ${toolDef.name}`);
    }

    server.registerTool(
      toolDef.name,
      {
        description: toolDef.description,
        inputSchema: jsonSchemaToInputSchema(toolDef.inputSchema),
      },
      async (args) => {
        // The MCP SDK's registerTool does NOT wrap handler exceptions; an
        // unhandled throw propagates to the bin's unhandledRejection handler
        // and tears down the entire stdio server. Catch here and surface as
        // an MCP error result so the client can recover.
        try {
          const text = await handler(args);
          return {
            content: [{ type: 'text', text }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err?.message || String(err) }) }],
            isError: true,
          };
        }
      }
    );
  }

  // 5. Register static resources and the agent history template
  for (const resDef of RESOURCE_DEFINITIONS) {
    const resourceHandler = resourceHandlers[resDef.uri];
    if (!resourceHandler) {
      throw new Error(`Missing handler for resource: ${resDef.uri}`);
    }

    if (resDef.isTemplate) {
      // URI template resource: dashclaw://agent/{agent_id}/history
      // readCallback is called with (uri, variables, ctx)
      const template = new ResourceTemplate(resDef.uri, { list: undefined });
      server.registerResource(
        resDef.name,
        template,
        {
          description: resDef.description,
          mimeType: resDef.mimeType,
        },
        async (uri, variables) => {
          const text = await resourceHandler(variables);
          return {
            contents: [{ uri: uri.href, mimeType: resDef.mimeType, text }],
          };
        }
      );
    } else {
      // Static resource
      // readCallback is called with (uri, ctx)
      server.registerResource(
        resDef.name,
        resDef.uri,
        {
          description: resDef.description,
          mimeType: resDef.mimeType,
        },
        async (uri) => {
          const text = await resourceHandler();
          return {
            contents: [{ uri: uri.href, mimeType: resDef.mimeType, text }],
          };
        }
      );
    }
  }

  return { server, client };
}
