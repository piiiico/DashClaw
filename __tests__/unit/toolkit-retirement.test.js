import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

describe('agent-toolkit retirement assertions', () => {
  it('agent-tools/ directory is gone', () => {
    expect(existsSync(path.resolve('agent-tools'))).toBe(false);
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
    const navbar = readFileSync(path.resolve('app/components/PublicNavbar.js'), 'utf8');
    expect(navbar).not.toMatch(/\/toolkit/);
  });

  it('PublicFooter has no /toolkit link', () => {
    const footer = readFileSync(path.resolve('app/components/PublicFooter.js'), 'utf8');
    expect(footer).not.toMatch(/\/toolkit/);
  });

  it('README mentions the MCP tools as the new toolkit surface', () => {
    const readme = readFileSync(path.resolve('README.md'), 'utf8');
    expect(readme).toMatch(/MCP tool/i);
  });
});
