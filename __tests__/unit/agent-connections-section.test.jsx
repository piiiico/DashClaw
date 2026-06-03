import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/ui/Badge.js', () => ({ Badge: ({ children }) => <span>{children}</span> }));

const { default: AgentConnectionsSection } = await import('@/agents/[agentId]/components/AgentConnectionsSection.jsx');

afterEach(() => { vi.unstubAllGlobals(); });

describe('AgentConnectionsSection', () => {
  it('renders provider connections with auth_type, plan_name and status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        connections: [
          { id: 'conn_1', provider: 'anthropic', auth_type: 'subscription', plan_name: 'Max', status: 'active', reported_at: '2026-06-01T00:00:00Z' },
          { id: 'conn_2', provider: 'openai', auth_type: 'api_key', plan_name: null, status: 'error', reported_at: null },
        ],
        total: 2,
      }),
    })));

    render(<AgentConnectionsSection agentId="agent-1" />);

    expect(await screen.findByText('anthropic')).toBeTruthy();
    expect(screen.getByText('subscription')).toBeTruthy();
    expect(screen.getByText('Max')).toBeTruthy();
    expect(screen.getByText('openai')).toBeTruthy();
    expect(screen.getByText('api_key')).toBeTruthy();
    expect(screen.getByText('error')).toBeTruthy();
  });

  it('shows an empty state when no connections are reported', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ connections: [], total: 0 }) })));
    render(<AgentConnectionsSection agentId="agent-1" />);
    expect(await screen.findByText(/no provider connections/i)).toBeTruthy();
  });
});
