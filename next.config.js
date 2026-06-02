/** @type {import('next').NextConfig} */

// Single source of truth for displayed version strings. Each entry derives
// from its package's authoritative manifest so a version bump never requires
// hand-editing UI copy. NEVER hardcode versions in app/ — read from these.
const PYPROJECT_VERSION_RE = /^version\s*=\s*"([^"]+)"/m;
const pyprojectMatch = require('fs')
  .readFileSync(require('path').join(__dirname, 'sdk-python', 'pyproject.toml'), 'utf8')
  .match(PYPROJECT_VERSION_RE);
if (!pyprojectMatch) {
  throw new Error('Could not parse version from sdk-python/pyproject.toml — UI version strings cannot resolve');
}

const { buildSecurityHeaderRules } = require('./app/lib/next-config-headers.cjs');

const nextConfig = {
  output: 'standalone',
  productionBrowserSourceMaps: false,
  env: {
    // Platform version — surfaced in the Sidebar build stamp.
    NEXT_PUBLIC_DASHCLAW_VERSION: require('./package.json').version,
    // Node SDK published to npm — surfaced in /docs and /downloads install copy.
    NEXT_PUBLIC_SDK_NODE_VERSION: require('./sdk/package.json').version,
    // Python SDK published to PyPI — surfaced in /docs and /downloads install copy.
    NEXT_PUBLIC_SDK_PYTHON_VERSION: pyprojectMatch[1],
    // Plugin bundle manifest version — surfaced in /downloads bundle description.
    NEXT_PUBLIC_PLUGIN_MANIFEST_VERSION: require('./plugins/dashclaw/.claude-plugin/plugin.json').version,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'api.dicebear.com' },
    ],
  },
  // Security headers — see app/lib/next-config-headers.cjs for the builder
  // (extracted so vitest can test the real function instead of a copy).
  // LAN self-host fix: TLS-conditional CSP + HSTS. Contributed by Lief (RyanTJoy).
  async headers() {
    return buildSecurityHeaderRules();
  },
  // API Rewrites for backward compatibility with older SDKs
  async rewrites() {
    return [
      { source: '/api/actions/:actionId/approve', destination: '/api/approvals/:actionId' },
      { source: '/api/actions/assumptions', destination: '/api/assumptions' },
      { source: '/api/actions/assumptions/:assumptionId', destination: '/api/assumptions/:assumptionId' },
      { source: '/api/actions/signals', destination: '/api/signals' },
      // Standard OIDC-style discovery path for the instance's public signing key
      // (used to re-verify integrity receipts + signed compliance bundles).
      { source: '/.well-known/jwks.json', destination: '/api/integrity/jwks' },
    ];
  },
  // Permanent redirects for retired surfaces.
  // The legacy Python agent-toolkit (/toolkit) has been replaced by the MCP tools
  // surface documented under /docs#mcp-tools (governed-agent MCP tools — handoffs,
  // secret rotation, skill safety, open loops, learning, audit retrospection).
  async redirects() {
    return [
      {
        source: '/toolkit',
        destination: '/docs#mcp-tools',
        permanent: true,
      },
    ];
  },
}

module.exports = nextConfig
