import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// The .js UI primitives contain JSX that Vite's oxc loader won't parse — mock them.
vi.mock('@/components/ui/Badge.js', () => ({ Badge: ({ children }) => <span>{children}</span> }));
vi.mock('@/components/ui/Card.js', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardHeader: ({ title }) => <div>{title}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/EmptyState.js', () => ({ EmptyState: ({ title, description }) => <div>{title}{description}</div> }));
vi.mock('@/policies/components/PolicyGeneratedDraftEditor.jsx', () => ({ default: () => <div /> }));

const { default: CustomTab } = await import('@/policies/components/CustomTab.jsx');

const POLICY = {
  id: 'gp_1',
  name: 'Block prod deploys',
  policy_type: 'block_action_type',
  rules: JSON.stringify({ action_types: ['deploy'], action: 'block' }),
  active: 1,
};

const SIM = {
  summary: { total: 10, matches: 3, block: 3, warn: 0, require_approval: 0, allow: 7 },
  matches: [
    {
      action_id: 'a1',
      goal: 'deploy to prod',
      agent_name: 'ci',
      timestamp: 't',
      original_status: 'completed',
      simulated_action: 'block',
      simulated_reason: 'Action type "deploy" is blocked by policy',
    },
  ],
  sample_size: 10,
  window_days: 7,
};

function mockFetch() {
  const routes = {
    'GET /api/policies': () => ({ policies: [POLICY] }),
    'GET /api/agents': () => ({ agents: [] }),
    'GET /api/policies/templates': () => ({ templates: [] }),
    'POST /api/policies/simulate': () => SIM,
  };
  return vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    const key = `${method} ${url.split('?')[0]}`;
    const handler = routes[key];
    return { ok: true, status: 200, json: async () => (handler ? handler() : {}) };
  });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('CustomTab — simulate impact panel (A3)', () => {
  it('renders an in-page panel with summary + sample matches and never calls window.alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.stubGlobal('fetch', mockFetch());

    render(<CustomTab />);
    await screen.findByText('Block prod deploys');

    fireEvent.click(screen.getByRole('button', { name: /simulate block prod deploys/i }));

    expect(await screen.findByText(/simulation impact/i)).toBeTruthy();
    expect(await screen.findByText('3 would match')).toBeTruthy();
    expect(screen.getByText('deploy to prod')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
