import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/components/ui/Card.js', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/Badge.js', () => ({
  Badge: ({ children }) => <span>{children}</span>,
}));

const { default: CodeSessionAlertsPanel } = await import('@/components/CodeSessionAlertsPanel.jsx');

afterEach(() => { vi.unstubAllGlobals(); });

const alert = {
  id: 1, kind: 'cost_anomaly', severity: 'critical', scope: 'session',
  title: 'Cost spike detected', body: '$5.20 in one session',
  project_id: 'proj_a', session_id: 'sess_1', read_at: null, created_at: '2026-06-01T00:00:00Z',
};

describe('CodeSessionAlertsPanel', () => {
  it('lists alerts with severity, kind, body, and a link to the session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ alerts: [alert], unread_count: 1 }) })));

    render(<CodeSessionAlertsPanel />);

    expect(await screen.findByText('Cost spike detected')).toBeTruthy();
    expect(screen.getByText('$5.20 in one session')).toBeTruthy();
    expect(screen.getByText('1 unread')).toBeTruthy();
    expect(screen.getByText('critical')).toBeTruthy();
    // links to the originating session
    const link = screen.getByText('Cost spike detected').closest('a');
    expect(link.getAttribute('href')).toBe('/code-sessions/proj_a/sess_1');
  });

  it('marks all read and refetches with a cleared unread count', async () => {
    let unread = 1;
    const fetchMock = vi.fn(async (url, options = {}) => {
      if ((options.method || 'GET') === 'POST') {
        unread = 0;
        return { ok: true, status: 200, json: async () => ({ marked: 1 }) };
      }
      return {
        ok: true, status: 200,
        json: async () => ({ alerts: [{ ...alert, read_at: unread === 0 ? '2026-06-02T00:00:00Z' : null }], unread_count: unread }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CodeSessionAlertsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /mark all read/i }));

    await waitFor(() => expect(screen.queryByText('1 unread')).toBeNull());
    // the read-all endpoint was hit
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/alerts/read-all') && c[1]?.method === 'POST')).toBe(true);
  });

  it('renders nothing when there are no alerts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ alerts: [], unread_count: 0 }) })));
    const { container } = render(<CodeSessionAlertsPanel />);
    await waitFor(() => expect(container.querySelector('button')).toBeNull());
    expect(screen.queryByText('Alerts')).toBeNull();
  });
});
