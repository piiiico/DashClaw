import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/components/ui/Card.js', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/Badge.js', () => ({
  Badge: ({ children }) => <span>{children}</span>,
}));
vi.mock('@/components/ui/Skeleton.js', () => ({
  ListSkeleton: () => <div data-testid="skeleton" />,
}));

const { default: DoctorPanel } = await import('@/components/DoctorPanel.jsx');

afterEach(() => { vi.unstubAllGlobals(); });

const initial = {
  status: 'needs_attention',
  summary: { pass: 1, warn: 1, fail: 0 },
  checks: [
    { id: 'env_secret', category: 'config', status: 'warn', title: 'NEXTAUTH_SECRET', message: 'not set', fix: { type: 'auto', description: 'Generate a secret', action: 'generate_secret' } },
    { id: 'db', category: 'database', status: 'pass', title: 'Database', message: 'reachable', fix: null },
  ],
};

describe('DoctorPanel', () => {
  it('renders checks grouped by category with status and a fix button', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => initial })));

    render(<DoctorPanel />);

    expect(await screen.findByText('NEXTAUTH_SECRET')).toBeTruthy();
    expect(screen.getByText('config')).toBeTruthy();
    expect(screen.getByText('database')).toBeTruthy();
    expect(screen.getByText('1 warn')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^fix$/i })).toBeTruthy();
  });

  it('applies a fix with the check action and swaps in the recheck result', async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      if ((options.method || 'GET') === 'POST') {
        return {
          ok: true, status: 200,
          json: async () => ({ ok: true, recheck: { status: 'healthy', summary: { pass: 2, warn: 0, fail: 0 }, checks: [
            { id: 'env_secret', category: 'config', status: 'pass', title: 'NEXTAUTH_SECRET', message: 'set', fix: null },
            { id: 'db', category: 'database', status: 'pass', title: 'Database', message: 'reachable', fix: null },
          ] } }),
        };
      }
      return { ok: true, status: 200, json: async () => initial };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DoctorPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /^fix$/i }));

    await waitFor(() => expect(screen.getByText('2 pass')).toBeTruthy());
    const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(postCall[0]).toContain('/api/doctor/fix');
    expect(JSON.parse(postCall[1].body)).toEqual({ action: 'generate_secret' });
    // the fixed check no longer offers a fix button
    expect(screen.queryByRole('button', { name: /^fix$/i })).toBeNull();
  });
});
