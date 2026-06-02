import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Pins the capability access dry-run: an agent_id + "Check access" resolves the
// effective decision via GET .../access/check and shows which rule matched.

const { default: CapabilityAccessTab } = await import('@/capabilities/[capabilityId]/components/CapabilityAccessTab.jsx');

afterEach(() => { vi.unstubAllGlobals(); });

function mockFetch(checkResponse) {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/access/check')) return { ok: true, status: 200, json: async () => checkResponse };
    return { ok: true, status: 200, json: async () => ({ rules: [] }) }; // GET .../access
  });
}

describe('CapabilityAccessTab — check effective access', () => {
  it('resolves an agent to a matching deny rule', async () => {
    const fetchFn = mockFetch({ access: 'deny', rule: { agent_id: 'deploy-bot', access: 'deny', reason: 'prod only' } });
    vi.stubGlobal('fetch', fetchFn);

    render(<CapabilityAccessTab capabilityId="cap_1" />);
    fireEvent.change(await screen.findByLabelText('Agent ID to check'), { target: { value: 'deploy-bot' } });
    fireEvent.click(screen.getByRole('button', { name: /check access/i }));

    expect(await screen.findByText('Deny')).toBeTruthy();
    expect(screen.getByText(/Matched rule for deploy-bot/)).toBeTruthy();
    const checkCall = fetchFn.mock.calls.find((c) => String(c[0]).includes('/access/check'));
    expect(checkCall[0]).toContain('agent_id=deploy-bot');
  });

  it('shows default-allow when no rule matches', async () => {
    vi.stubGlobal('fetch', mockFetch({ access: 'allow', rule: null }));

    render(<CapabilityAccessTab capabilityId="cap_1" />);
    fireEvent.change(await screen.findByLabelText('Agent ID to check'), { target: { value: 'anyone' } });
    fireEvent.click(screen.getByRole('button', { name: /check access/i }));

    expect(await screen.findByText('Allow')).toBeTruthy();
    expect(screen.getByText(/No rule matched — default allow/)).toBeTruthy();
  });
});
