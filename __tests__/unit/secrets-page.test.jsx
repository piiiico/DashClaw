import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Pins the /api/secrets contract the Secrets rotation page depends on:
// list (org-wide or ?agent_id), create (POST), mark-rotated (PATCH
// last_rotated_at), delete (DELETE), and the org-wide rotation-due banner.
// Admin gating flows through the real useEffectiveRole hook, so the fetch
// mock answers /api/session/effective like the live route does.

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, actions }) => (
    <div><h1>{title}</h1><div>{actions}</div><div>{children}</div></div>
  ),
}));
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children }) => <span>{children}</span>,
}));
vi.mock('@/components/ui/EmptyState', () => ({
  EmptyState: ({ title, description, action }) => (
    <div><div>{title}</div><div>{description}</div><div>{action}</div></div>
  ),
}));
vi.mock('@/lib/isDemoMode', () => ({ isDemoMode: () => false }));

const { default: SecretsPage } = await import('@/secrets/page.jsx');

const SECRET = {
  id: 'sec_1',
  name: 'ANTHROPIC_API_KEY',
  agent_id: null,
  last_rotated_at: '2026-01-01T00:00:00Z',
  rotation_interval_days: 90,
  next_rotation_due: '2026-04-01T00:00:00Z',
  notes: 'lives in vault',
};

function makeFetch({ role = 'admin', secrets = [], due = [] }) {
  const store = [...secrets];
  return vi.fn(async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
    if (u === '/api/session/effective') {
      return { ok: true, status: 200, json: async () => ({ authenticated: true, role, authType: 'nextauth', isAdmin: role === 'admin' }) };
    }
    if (u.startsWith('/api/secrets/rotation-due')) {
      return { ok: true, status: 200, json: async () => ({ due, within_days: 14 }) };
    }
    if (u === '/api/secrets' && method === 'POST') {
      const body = JSON.parse(options.body);
      store.push({
        id: 'sec_new', name: body.name, agent_id: body.agent_id || null,
        last_rotated_at: '2026-06-02T00:00:00Z', rotation_interval_days: body.rotation_interval_days,
        next_rotation_due: '2026-09-01T00:00:00Z', notes: body.notes || null,
      });
      return { ok: true, status: 201, json: async () => ({ id: 'sec_new', name: body.name }) };
    }
    if (u.startsWith('/api/secrets/sec')) {
      if (method === 'PATCH') return { ok: true, status: 200, json: async () => ({ id: 'sec_1', last_rotated_at: JSON.parse(options.body).last_rotated_at }) };
      if (method === 'DELETE') return { ok: true, status: 200, json: async () => ({ deleted: 'sec_1' }) };
    }
    if (u.startsWith('/api/secrets')) {
      return { ok: true, status: 200, json: async () => ({ secrets: store }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('SecretsPage', () => {
  it('lists tracked secrets with admin rotate + delete controls', async () => {
    global.fetch = makeFetch({ role: 'admin', secrets: [SECRET] });
    render(<SecretsPage />);

    expect(await screen.findByText('ANTHROPIC_API_KEY')).toBeTruthy();
    expect(screen.getByText('lives in vault')).toBeTruthy();
    expect(screen.getByText('Mark rotated')).toBeTruthy();
    expect(screen.getByLabelText('Delete ANTHROPIC_API_KEY')).toBeTruthy();
  });

  it('marks a secret rotated with a fresh last_rotated_at via PATCH', async () => {
    const fetchFn = makeFetch({ role: 'admin', secrets: [SECRET] });
    global.fetch = fetchFn;
    render(<SecretsPage />);

    fireEvent.click(await screen.findByText('Mark rotated'));

    await waitFor(() => expect(fetchFn.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(true));
    const patch = fetchFn.mock.calls.find((c) => c[1]?.method === 'PATCH');
    expect(patch[0]).toBe('/api/secrets/sec_1');
    expect(JSON.parse(patch[1].body).last_rotated_at).toBeTruthy();
  });

  it('deletes a secret via DELETE after confirmation', async () => {
    vi.stubGlobal('confirm', () => true);
    const fetchFn = makeFetch({ role: 'admin', secrets: [SECRET] });
    global.fetch = fetchFn;
    render(<SecretsPage />);

    fireEvent.click(await screen.findByLabelText('Delete ANTHROPIC_API_KEY'));

    await waitFor(() => expect(fetchFn.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(true));
    const del = fetchFn.mock.calls.find((c) => c[1]?.method === 'DELETE');
    expect(del[0]).toBe('/api/secrets/sec_1');
  });

  it('creates a secret and shows it after refetch', async () => {
    const fetchFn = makeFetch({ role: 'admin', secrets: [] });
    global.fetch = fetchFn;
    render(<SecretsPage />);

    await screen.findByText('No secrets tracked yet');
    fireEvent.click(screen.getAllByText('Track a secret')[0]);
    fireEvent.change(screen.getByLabelText('Secret name'), { target: { value: 'NEW_KEY' } });
    fireEvent.click(screen.getByText('Track secret'));

    expect(await screen.findByText('NEW_KEY')).toBeTruthy();
    const post = fetchFn.mock.calls.find((c) => c[0] === '/api/secrets' && c[1]?.method === 'POST');
    expect(JSON.parse(post[1].body)).toMatchObject({ name: 'NEW_KEY', agent_id: null, rotation_interval_days: 90, notes: null });
  });

  it('surfaces the org-wide rotation-due banner with overdue framing', async () => {
    global.fetch = makeFetch({
      role: 'admin',
      secrets: [],
      due: [{ id: 'sec_old', name: 'OLD_KEY', agent_id: 'agent-1', days_until_due: -3 }],
    });
    render(<SecretsPage />);

    expect(await screen.findByText('1 secret due for rotation')).toBeTruthy();
    expect(screen.getByText('OLD_KEY')).toBeTruthy();
    expect(screen.getByText('overdue 3d')).toBeTruthy();
  });

  it('is read-only for a non-admin member', async () => {
    global.fetch = makeFetch({ role: 'member', secrets: [SECRET] });
    render(<SecretsPage />);

    expect(await screen.findByText('ANTHROPIC_API_KEY')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Only workspace admins can track, rotate, or delete/i)).toBeTruthy());
    expect(screen.queryByText('Mark rotated')).toBeNull();
  });
});
