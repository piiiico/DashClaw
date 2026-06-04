import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/components/ui/Card.js', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
  CardHeader: ({ title }) => <div>{title}</div>,
}));
vi.mock('@/components/ui/Badge.js', () => ({
  Badge: ({ children }) => <span>{children}</span>,
}));

const { default: InvokePanel } = await import('@/agents/registry/components/InvokePanel.jsx');

const AGENT = { entry_id: 'reg_1', name: 'Acme', slug: 'acme', status: 'active' };
const CAPS = [{ capability_id: 'cap_1', name: 'Send Email', risk_level: 'medium' }];

function mockFetch(handler) {
  global.fetch = vi.fn(handler);
}

beforeEach(() => {
  // Default: /api/agents returns an empty caller list; invoke returns success.
  mockFetch(async (url) => {
    if (String(url).startsWith('/api/agents/invoke')) {
      return { ok: true, status: 200, json: async () => ({ success: true, action_id: 'act_42', result: { ok: 1 } }) };
    }
    return { ok: true, status: 200, json: async () => ({ agents: [] }) };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Registry InvokePanel', () => {
  it('blocks invalid JSON payloads with an inline error and does not POST', async () => {
    render(<InvokePanel agent={AGENT} capabilities={CAPS} />);

    // Select the capability so the Invoke button enables.
    fireEvent.change(screen.getByRole('combobox', { name: /capability/i }), { target: { value: 'cap_1' } });
    fireEvent.change(screen.getByRole('textbox', { name: /payload/i }), { target: { value: '{ not json' } });
    fireEvent.click(screen.getByRole('button', { name: /invoke/i }));

    expect(await screen.findByText('Invalid JSON.')).toBeTruthy();
    // No invoke POST should have fired.
    const invokeCalls = global.fetch.mock.calls.filter((c) => String(c[0]).startsWith('/api/agents/invoke'));
    expect(invokeCalls.length).toBe(0);
  });

  it('renders a governed success result with a link to /decisions', async () => {
    render(<InvokePanel agent={AGENT} capabilities={CAPS} />);

    fireEvent.change(screen.getByRole('combobox', { name: /capability/i }), { target: { value: 'cap_1' } });
    fireEvent.click(screen.getByRole('button', { name: /invoke/i }));

    await waitFor(() => expect(screen.getByText('Completed')).toBeTruthy());
    const link = screen.getByText(/View in Decisions/i);
    expect(link.getAttribute('href')).toBe('/decisions/act_42');
  });

  it('shows guidance when the agent has no grouped capabilities', () => {
    render(<InvokePanel agent={AGENT} capabilities={[]} />);
    expect(screen.getByText(/Add a capability to this agent/i)).toBeTruthy();
  });
});
