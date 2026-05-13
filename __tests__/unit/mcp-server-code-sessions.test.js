import { describe, it, expect } from 'vitest';
import { TOOL_DEFINITIONS } from '../../mcp-server/lib/tools.js';
import { RESOURCE_DEFINITIONS } from '../../mcp-server/lib/resources.js';

describe('MCP Code Sessions surface', () => {
  it('TOOL_DEFINITIONS includes the two Optimal Files tools', () => {
    const names = TOOL_DEFINITIONS.map(t => t.name);
    expect(names).toContain('dashclaw_optimal_files_preview');
    expect(names).toContain('dashclaw_optimal_files_manifest');
  });

  it('RESOURCE_DEFINITIONS includes the code-sessions projects + session-detail entries', () => {
    const uris = RESOURCE_DEFINITIONS.map(r => r.uri);
    expect(uris).toContain('dashclaw://code-sessions/projects');
    expect(uris).toContain('dashclaw://code-sessions/sessions/{session_id}');
  });

  it('every code-sessions tool/resource has a non-trivial description', () => {
    for (const def of TOOL_DEFINITIONS) {
      if (!def.name.includes('optimal_files')) continue;
      expect(def.description.length).toBeGreaterThan(50);
    }
    for (const def of RESOURCE_DEFINITIONS) {
      if (!def.uri.includes('code-sessions')) continue;
      expect(def.description.length).toBeGreaterThan(30);
    }
  });
});
