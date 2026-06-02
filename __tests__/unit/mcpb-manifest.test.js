import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildMcpbManifest, readMcpServerVersion } from '../../scripts/lib/build-mcpb-manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('buildMcpbManifest', () => {
  it('requires a version string', () => {
    expect(() => buildMcpbManifest()).toThrow();
    expect(() => buildMcpbManifest(123)).toThrow();
  });

  it('produces a v0.3 manifest with the given version', () => {
    const m = buildMcpbManifest('1.2.3');
    expect(m.manifest_version).toBe('0.3');
    expect(m.name).toBe('dashclaw');
    expect(m.version).toBe('1.2.3');
    expect(m.author.name).toBe('DashClaw');
  });

  it('points the node server at the stdio entry and maps env from user_config', () => {
    const m = buildMcpbManifest('1.2.3');
    expect(m.server.type).toBe('node');
    expect(m.server.entry_point).toBe('bin/dashclaw-mcp.js');
    expect(m.server.mcp_config.command).toBe('node');
    expect(m.server.mcp_config.args).toEqual(['${__dirname}/bin/dashclaw-mcp.js']);
    expect(m.server.mcp_config.env).toEqual({
      DASHCLAW_URL: '${user_config.dashclaw_url}',
      DASHCLAW_API_KEY: '${user_config.dashclaw_api_key}',
      DASHCLAW_AGENT_ID: '${user_config.dashclaw_agent_id}',
    });
  });

  it('declares user_config: required url, sensitive key, defaulted agent id', () => {
    const { user_config: uc } = buildMcpbManifest('1.2.3');
    expect(uc.dashclaw_url.required).toBe(true);
    expect(uc.dashclaw_api_key.sensitive).toBe(true);
    expect(uc.dashclaw_api_key.required).toBe(true);
    expect(uc.dashclaw_agent_id.default).toBe('claude-desktop');
    expect(uc.dashclaw_agent_id.required).toBe(false);
  });

  it('readMcpServerVersion returns the real mcp-server package version', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'mcp-server', 'package.json'), 'utf8'));
    expect(readMcpServerVersion()).toBe(pkg.version);
  });
});
