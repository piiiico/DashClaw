#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/server';
import { createServer } from '../lib/server.js';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Parse CLI args: --url, --key, --agent-id
const args = process.argv.slice(2);
const config = {};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--url':
      config.url = args[++i];
      break;
    case '--key':
      config.apiKey = args[++i];
      break;
    case '--agent-id':
      config.agentId = args[++i];
      break;
    case '--help':
      console.error(`Usage: dashclaw-mcp [options]

Options:
  --url <url>          DashClaw instance URL (default: http://localhost:3000)
  --key <key>          API key (oc_live_ prefix)
  --agent-id <id>      Default agent ID

Environment variables (fallback):
  DASHCLAW_URL         DashClaw instance URL
  DASHCLAW_API_KEY     API key
  DASHCLAW_AGENT_ID    Default agent ID`);
      process.exit(0);
      break;
  }
}

// Env vars as fallback
config.url = config.url || process.env.DASHCLAW_URL;
config.apiKey = config.apiKey || process.env.DASHCLAW_API_KEY;
config.agentId = config.agentId || process.env.DASHCLAW_AGENT_ID;

const { server, client } = createServer(config);
const transport = new StdioServerTransport();
// Auto-derive agent_id from the MCP `initialize` clientInfo when the user
// hasn't supplied --agent-id or DASHCLAW_AGENT_ID. Without this, every call
// from Claude Desktop, MCP Inspector, etc. arrives with an empty agent_id and
// silently commingles with whatever default the server falls back to (almost
// always `claude-code`). The MCP protocol's clientInfo.name identifies the
// connecting client (e.g. "claude-ai" for Claude Desktop, "cursor-vscode" for
// Cursor) so we use it as a sensible default — explicit configuration still
// wins, because we only set it when client.agentId is empty.
//
// IMPORTANT: install the patch BEFORE server.connect(transport). connect()
// starts reading stdin synchronously and may dispatch the `initialize`
// message before our hook is in place; if patched after, agent_id never
// gets set for the very first session.
const originalOnMessage = transport.onmessage;
const installAgentIdHook = (base) => (message) => {
  if (
    message?.method === 'initialize' &&
    !client.agentId &&
    message.params?.clientInfo?.name
  ) {
    client.agentId = String(message.params.clientInfo.name);
    console.error(`[dashclaw] auto-derived agent_id from MCP clientInfo: ${client.agentId}`);
  }
  return base ? base(message) : undefined;
};
transport.onmessage = installAgentIdHook(originalOnMessage);

await server.connect(transport);

// connect() may have replaced onmessage during handshake setup. Re-wrap
// post-connect so the hook also fires for any subsequent re-init message.
if (transport.onmessage !== installAgentIdHook(originalOnMessage)) {
  const postConnectBase = transport.onmessage;
  transport.onmessage = installAgentIdHook(postConnectBase);
}

console.error('@dashclaw/mcp-server running on stdio');
