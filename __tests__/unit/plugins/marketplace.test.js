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
