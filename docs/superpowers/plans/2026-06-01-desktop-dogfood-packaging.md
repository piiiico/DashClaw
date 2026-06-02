# Desktop Dogfood Packaging (Leg 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DashClaw installable in the Claude consumer app today — a one-click `.mcpb` local connector (wrapping the existing stdio MCP server) and a repo-root `marketplace.json` so the existing plugin's two skills install via Customize → Plugins.

**Architecture:** No backend change. (1) A pure manifest-builder + a build script stage `mcp-server/` with production deps and a generated `manifest.json`, then run `@anthropic-ai/mcpb pack` to emit `dist/dashclaw.mcpb`. (2) A static `.claude-plugin/marketplace.json` at the repo root points at the existing `plugins/dashclaw` plugin so users add the GitHub repo as a personal marketplace. Both are validated by unit tests.

**Tech Stack:** Node 20 ESM, Vitest, `@anthropic-ai/mcpb` CLI, the existing `mcp-server/` package (`@dashclaw/mcp-server` v1.0.2).

---

## Reference facts (verified — do not re-derive)

- `.mcpb` manifest schema (mcpb v0.3): required `manifest_version`, `name`, `version`, `description`, `author.name`, `server`. `server.mcp_config.env` values use `${user_config.KEY}`; `${__dirname}` expands to the install dir. `user_config` entries: `{ type, title, description, required, sensitive, default }`. Source: https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md
- `marketplace.json` schema: required `name` (kebab, not a reserved name), `owner` (`{name, email?}`), `plugins[]` (each `{name, source, ...}`). `metadata.pluginRoot` prepends to relative `source`. Source: https://code.claude.com/docs/en/plugin-marketplaces
- Reserved marketplace names (cannot use): `claude-code-marketplace`, `claude-code-plugins`, `claude-plugins-official`, `anthropic-marketplace`, `anthropic-plugins`, `agent-skills`, `anthropic-agent-skills`, `knowledge-work-plugins`, `life-sciences`, `claude-for-legal`, `claude-for-financial-services`, `financial-services-plugins`. `dashclaw` is **not** reserved.
- The stdio server `mcp-server/bin/dashclaw-mcp.js` reads env `DASHCLAW_URL`, `DASHCLAW_API_KEY`, `DASHCLAW_AGENT_ID`.
- The `.mcpb` `version` tracks `mcp-server/package.json` (currently `1.0.2`) — NOT the plugin's `2.14.0`. Never hardcode it (repo `version:check` rule); the build reads it from `package.json`.
- `mcp-server/` has a `package-lock.json` (needed for `npm ci` in staging).

## File structure

- Create `scripts/lib/build-mcpb-manifest.mjs` — pure: `buildMcpbManifest(version)` + `readMcpServerVersion()`. One responsibility: produce the manifest object. Testable without the CLI.
- Create `scripts/build-mcpb.mjs` — orchestration: stage `mcp-server/`, `npm ci --omit=dev`, write manifest, run `mcpb pack` → `dist/dashclaw.mcpb`.
- Create `.claude-plugin/marketplace.json` — repo-root marketplace catalog listing the `dashclaw` plugin.
- Create `__tests__/unit/mcpb-manifest.test.js` — validates the manifest builder.
- Create `__tests__/unit/plugins/marketplace.test.js` — validates the marketplace catalog + plugin cross-reference.
- Modify `.gitignore` — ignore the `dist/` build output.
- Modify `mcp-server/README.md` — add "Install in Claude Desktop" (`.mcpb` + marketplace) section.

---

### Task 1: Marketplace catalog + validation test

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Test: `__tests__/unit/plugins/marketplace.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// __tests__/unit/plugins/marketplace.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const RESERVED = new Set([
  'claude-code-marketplace', 'claude-code-plugins', 'claude-plugins-official',
  'anthropic-marketplace', 'anthropic-plugins', 'agent-skills', 'anthropic-agent-skills',
  'knowledge-work-plugins', 'life-sciences', 'claude-for-legal',
  'claude-for-financial-services', 'financial-services-plugins',
]);

describe('.claude-plugin/marketplace.json', () => {
  const mkt = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));

  it('has a valid, non-reserved kebab-case name', () => {
    expect(mkt.name).toBe('dashclaw');
    expect(RESERVED.has(mkt.name)).toBe(false);
    expect(mkt.name).toMatch(/^[a-z0-9-]+$/);
  });

  it('declares an owner with a name', () => {
    expect(mkt.owner?.name).toBeTruthy();
  });

  it('lists the dashclaw plugin with a resolvable source', () => {
    expect(Array.isArray(mkt.plugins)).toBe(true);
    expect(mkt.plugins).toHaveLength(1);
    const entry = mkt.plugins[0];
    expect(entry.name).toBe('dashclaw');
    // pluginRoot "./plugins" + source "dashclaw" → plugins/dashclaw
    const pluginRoot = mkt.metadata?.pluginRoot ?? '.';
    const pluginDir = join(ROOT, pluginRoot, entry.source);
    expect(existsSync(join(pluginDir, '.claude-plugin', 'plugin.json'))).toBe(true);
  });

  it('marketplace plugin name matches the plugin manifest name', () => {
    const entry = mkt.plugins[0];
    const pluginRoot = mkt.metadata?.pluginRoot ?? '.';
    const manifest = JSON.parse(
      readFileSync(join(ROOT, pluginRoot, entry.source, '.claude-plugin', 'plugin.json'), 'utf8')
    );
    expect(manifest.name).toBe(entry.name);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/plugins/marketplace.test.js`
Expected: FAIL — `ENOENT … .claude-plugin/marketplace.json` (file does not exist yet).

- [ ] **Step 3: Create the marketplace catalog**

```json
// .claude-plugin/marketplace.json
{
  "name": "dashclaw",
  "owner": { "name": "DashClaw", "email": "team@dashclaw.io" },
  "metadata": { "pluginRoot": "./plugins" },
  "plugins": [
    {
      "name": "dashclaw",
      "source": "dashclaw",
      "description": "DashClaw governance, integration, and platform intelligence: guard checks, approvals, and audit trails for your agents.",
      "category": "Developer Tools",
      "tags": ["governance", "mcp", "agent-safety", "approval"]
    }
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/plugins/marketplace.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin/marketplace.json __tests__/unit/plugins/marketplace.test.js
git commit -m "feat(plugin): add repo-root marketplace.json for Claude app install"
```

---

### Task 2: `.mcpb` manifest builder (pure) + test

**Files:**
- Create: `scripts/lib/build-mcpb-manifest.mjs`
- Test: `__tests__/unit/mcpb-manifest.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// __tests__/unit/mcpb-manifest.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/mcpb-manifest.test.js`
Expected: FAIL — cannot resolve `../../scripts/lib/build-mcpb-manifest.mjs`.

- [ ] **Step 3: Write the manifest builder**

```javascript
// scripts/lib/build-mcpb-manifest.mjs
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/mcpb-manifest.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/build-mcpb-manifest.mjs __tests__/unit/mcpb-manifest.test.js
git commit -m "feat(mcpb): add .mcpb manifest builder for the DashClaw connector bundle"
```

---

### Task 3: The build script (`mcpb pack`)

**Files:**
- Create: `scripts/build-mcpb.mjs`
- Modify: `.gitignore`

This task has no unit test — it shells out to `npm ci` and the `mcpb` CLI (network + binary). It is exercised by the manual verification in Task 5. Keep it thin; all pure logic lives in Task 2's tested module.

- [ ] **Step 1: Add the build output to `.gitignore`**

Append to `.gitignore` (only if `dist/` is not already ignored):

```
# mcpb build output
dist/
```

- [ ] **Step 2: Write the build script**

```javascript
// scripts/build-mcpb.mjs
#!/usr/bin/env node
import { mkdirSync, rmSync, cpSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildMcpbManifest, readMcpServerVersion } from './lib/build-mcpb-manifest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MCP = join(ROOT, 'mcp-server');
const STAGE = join(ROOT, 'dist', 'mcpb-build');
const OUT = join(ROOT, 'dist', 'dashclaw.mcpb');

// Windows uses npm.cmd / npx.cmd; Linux/macOS (Vercel CI) use npm / npx.
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// 1. Fresh staging dir
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

// 2. Copy the publishable server source + lockfile (needed for npm ci)
for (const f of ['bin', 'lib', 'package.json', 'package-lock.json', 'LICENSE', 'README.md']) {
  const src = join(MCP, f);
  if (existsSync(src)) cpSync(src, join(STAGE, f), { recursive: true });
}

// 3. Install production deps into the bundle
execFileSync(npmBin, ['ci', '--omit=dev'], { cwd: STAGE, stdio: 'inherit' });

// 4. Generate manifest.json with the version from package.json (never hardcoded)
const version = readMcpServerVersion();
writeFileSync(
  join(STAGE, 'manifest.json'),
  JSON.stringify(buildMcpbManifest(version), null, 2) + '\n'
);

// 5. Pack the bundle
execFileSync(npxBin, ['--yes', '@anthropic-ai/mcpb@latest', 'pack', STAGE, OUT], {
  cwd: ROOT,
  stdio: 'inherit',
});

console.log(`\nBuilt ${OUT} (v${version})`);
```

- [ ] **Step 3: Run the build to verify it produces a bundle**

Run: `node scripts/build-mcpb.mjs`
Expected: ends with `Built …/dist/dashclaw.mcpb (v1.0.2)`; `dist/dashclaw.mcpb` exists and is a non-empty zip.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-mcpb.mjs .gitignore
git commit -m "feat(mcpb): add build-mcpb script that packs the DashClaw connector bundle"
```

---

### Task 4: Docs — "Install in Claude Desktop"

**Files:**
- Modify: `mcp-server/README.md`

- [ ] **Step 1: Add an install section after the "Quick Start" block**

Insert into `mcp-server/README.md` immediately after the "Claude Managed Agents (Streamable HTTP)" subsection (before "## Tools (23)"):

```markdown
### Claude Desktop / Cowork (one-click .mcpb)

Build the bundle and install it without touching `claude_desktop_config.json`:

```bash
node scripts/build-mcpb.mjs    # → dist/dashclaw.mcpb
```

Then double-click `dist/dashclaw.mcpb` (or Settings → Extensions → Install Extension…).
The installer prompts for your instance URL, API key, and an agent ID
(default `claude-desktop`). The 23 governance tools then appear in Claude.

### Plugin (skills) via marketplace

To also load the DashClaw **skills** (governance protocol + platform intelligence)
in the Claude app: Customize → Plugins → "+" → Add marketplace →
`github: ucsandman/DashClaw`, then install the `dashclaw` plugin.
```

- [ ] **Step 2: Commit**

```bash
git add mcp-server/README.md
git commit -m "docs(mcp-server): document .mcpb + marketplace install for the Claude app"
```

---

### Task 5: Full-suite verification + manual smoke test

- [ ] **Step 1: Run the full unit suite (per project rule — not a targeted run)**

Run: `npx vitest run`
Expected: PASS, including the two new files. No regressions.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean (no new errors).

- [ ] **Step 3: Build the bundle**

Run: `node scripts/build-mcpb.mjs`
Expected: `dist/dashclaw.mcpb` produced.

- [ ] **Step 4: Manual smoke test (cannot be unit-tested — needs the desktop app)**

Do these by hand and record the result in the task notes:
1. Double-click `dist/dashclaw.mcpb` → installer prompts for URL / API key / agent ID.
2. Enter a real DashClaw instance URL + `oc_live_` key + `claude-desktop`.
3. In Claude, confirm the DashClaw tools are listed; run a `dashclaw_guard` for a low-risk action and confirm a decision returns.
4. In the DashClaw dashboard, confirm a session/decision shows on `/fleet` and `/decisions` under agent `claude-desktop`.
5. Customize → Plugins → add `github: ucsandman/DashClaw` → install `dashclaw` → confirm both skills appear under Customize → Skills.

- [ ] **Step 5: Note any deviations**

If the consumer plugin surface does NOT run the plugin's own `.mcp.json` stdio connector (an officially-undocumented behavior — see spec §1c), record that the `.mcpb` is the working local-connector path and the plugin delivers the skills. Do not block on it.

---

## Self-Review

- **Spec coverage (Leg 1 of `2026-06-01-dashclaw-desktop-plugin-design.md`):** `.mcpb` bundle of the stdio server → Tasks 2–3. `user_config` for URL/key/agent-id → Task 2. Repo-root `marketplace.json` → Task 1. Docs → Task 4. "Verify which surface runs what" caveat → Task 5 Step 5. Blank `DASHCLAW_URL` default (locked decision #4) → Task 2 (`dashclaw_url` has no default). All covered.
- **Placeholder scan:** No TBD/TODO; every code/JSON step is complete; commands have expected output. The only non-automated step (Task 5 Step 4) is explicitly a manual smoke test because it requires the desktop app.
- **Type/name consistency:** `buildMcpbManifest`/`readMcpServerVersion` names, the three `user_config` keys (`dashclaw_url`, `dashclaw_api_key`, `dashclaw_agent_id`), and the env var names (`DASHCLAW_URL`/`DASHCLAW_API_KEY`/`DASHCLAW_AGENT_ID`) match across Tasks 2, 3, and the stdio bin. Marketplace `name`/plugin `source` (`dashclaw`/`dashclaw`) consistent across Task 1 test + catalog.
