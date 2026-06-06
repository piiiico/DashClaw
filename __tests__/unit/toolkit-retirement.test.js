import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Check specific deleted tool files rather than the parent dir.
// On Windows, `git rm` leaves empty parent dirs behind on dev machines that
// previously had the files checked out; the dir entry has no meaning once
// every tracked file under it is gone. Asserting on specific files matches
// what "retirement" actually means (no one can run these tools) and passes
// uniformly in CI (fresh checkout) and on dev machines that pulled the
// deletion commit.
const RETIRED_TOOL_FILES = [
  'agent-tools/tools/sync_to_dashclaw.py',
  'agent-tools/tools/_shared/dashclaw_push.py',
  'agent-tools/tools/session-handoff/handoff.py',
  'agent-tools/tools/security/secret_tracker.py',
  'agent-tools/tools/security/skill_checker.py',
  'agent-tools/tools/open-loops/loops.py',
  'agent-tools/tools/learning-database/learner.py',
  'agent-tools/install-mac.sh',
  'agent-tools/install-windows.ps1',
  'agent-tools/README.md',
];

describe('agent-toolkit retirement assertions', () => {
  it.each(RETIRED_TOOL_FILES)('retired tool file is gone: %s', (rel) => {
    expect(existsSync(path.resolve(rel))).toBe(false);
  });

  it('app/toolkit/page.js is gone', () => {
    expect(existsSync(path.resolve('app/toolkit/page.js'))).toBe(false);
  });

  it('next.config.js redirects /toolkit -> /docs#mcp-tools', () => {
    const cfg = readFileSync(path.resolve('next.config.js'), 'utf8');
    expect(cfg).toMatch(/\/toolkit/);
    expect(cfg).toMatch(/\/docs#mcp-tools/);
  });

  it('PublicNavbar has no /toolkit link', () => {
    const navbar = readFileSync(path.resolve('app/components/PublicNavbar.tsx'), 'utf8');
    expect(navbar).not.toMatch(/\/toolkit/);
  });

  it('PublicFooter has no /toolkit link', () => {
    const footer = readFileSync(path.resolve('app/components/PublicFooter.tsx'), 'utf8');
    expect(footer).not.toMatch(/\/toolkit/);
  });

  it('README mentions the MCP tools as the new toolkit surface', () => {
    const readme = readFileSync(path.resolve('README.md'), 'utf8');
    expect(readme).toMatch(/MCP tool/i);
  });
});
