import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_DIR = join(__dirname, '..', '..', 'mcp-server');

/**
 * Build the .mcpb manifest object. `version` is injected at build time from
 * mcp-server/package.json so it is never hardcoded in a committed file.
 */
export function buildMcpbManifest(version) {
  if (!version || typeof version !== 'string') {
    throw new Error('buildMcpbManifest: version (string) is required');
  }
  return {
    manifest_version: '0.3',
    name: 'dashclaw',
    version,
    description: 'Govern agents with guard checks, approvals, and audit trails.',
    author: { name: 'DashClaw', url: 'https://dashclaw.io' },
    homepage: 'https://dashclaw.io/docs',
    server: {
      type: 'node',
      entry_point: 'bin/dashclaw-mcp.js',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/bin/dashclaw-mcp.js'],
        env: {
          DASHCLAW_URL: '${user_config.dashclaw_url}',
          DASHCLAW_API_KEY: '${user_config.dashclaw_api_key}',
          DASHCLAW_AGENT_ID: '${user_config.dashclaw_agent_id}',
        },
      },
    },
    user_config: {
      dashclaw_url: {
        type: 'string',
        title: 'DashClaw instance URL',
        description: 'e.g. https://your-dashclaw.vercel.app',
        required: true,
      },
      dashclaw_api_key: {
        type: 'string',
        title: 'API key',
        description: 'oc_live_ key from your DashClaw instance (Settings → API keys)',
        required: true,
        sensitive: true,
      },
      dashclaw_agent_id: {
        type: 'string',
        title: 'Agent ID',
        description: 'Name shown on /fleet and /decisions',
        required: false,
        default: 'claude-desktop',
      },
    },
  };
}

export function readMcpServerVersion() {
  const pkg = JSON.parse(readFileSync(join(MCP_SERVER_DIR, 'package.json'), 'utf8'));
  return pkg.version;
}
