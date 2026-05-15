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
  // Security headers
  async headers() {
    // LAN self-host fix: TLS-conditional CSP + HSTS. Contributed by Lief (RyanTJoy).
    const isTLS = (process.env.NEXTAUTH_URL || '').startsWith('https');

    const csp = [
      "default-src 'self'",
      // In dev mode, Next.js needs 'unsafe-eval' for hot reloading
      `script-src 'self' 'unsafe-inline' ${process.env.NODE_ENV === 'development' ? "'unsafe-eval'" : ''}`,
      // Disallow inline event handlers like onclick="..."
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://avatars.githubusercontent.com https://lh3.googleusercontent.com https://api.dicebear.com",
      "font-src 'self' data:",
      "connect-src 'self' https://*.neon.tech https://github.com https://accounts.google.com https://checkout.stripe.com https://billing.stripe.com",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "frame-src 'self' https://www.loom.com https://www.youtube-nocookie.com",
      "form-action 'self'",
      ...(isTLS ? ['upgrade-insecure-requests', 'block-all-mixed-content'] : []),
    ].join('; ');

    const result = [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: csp,
          },
        ],
      },
    ];

    if (isTLS) {
      result[0].headers.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      });
    }

    return result;
  },
  // API Rewrites for backward compatibility with older SDKs
  async rewrites() {
    return [
      { source: '/api/actions/:actionId/approve', destination: '/api/approvals/:actionId' },
      { source: '/api/actions/assumptions', destination: '/api/assumptions' },
      { source: '/api/actions/assumptions/:assumptionId', destination: '/api/assumptions/:assumptionId' },
      { source: '/api/actions/signals', destination: '/api/signals' },
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
