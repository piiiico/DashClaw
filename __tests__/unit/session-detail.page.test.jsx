import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Pins the agent-session status controls: the PATCH route was unreachable from
// the UI, so a blocked/stalled session could never be cleared or finished.
// "Clear block" -> PATCH { status: 'running' }, "Mark finished" -> { status:
// 'finished' }, and a closed-session 409 surfaces an error instead of failing
// silently.

vi.mock('next/link', () => ({ default: ({ href, children, ...p }) => <a href={href} {...p}>{children}</a> }));
vi.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 'cs_1' }) }));
vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, actions }) => (<div><h1>{title}</h1><div>{actions}</div><div>{children}</div></div>),
}));
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/Skeleton', () => ({ Skeleton: () => <div /> }));

const { default: SessionDetailPage } = await import('@/sessions/[sessionId]/page.jsx');

const BLOCKED = { id: 'cs_1', agent_id: 'hermes', status: 'blocked', blocked_reason: 'awaiting review', workspace: 'ws', branch: 'main' };

function makeFetch({ patchStatus = 200, patchBody } = {}) {
  return vi.fn(async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
    if (u === '/api/sessions/cs_1' && method === 'GET') return { ok: true, json: async () => ({ session: BLOCKED }) };
    if (u === '/api/sessions/cs_1/events') return { ok: true, json: async () => ({ events: [] }) };
    if (u === '/api/sessions/cs_1' && method === 'PATCH') {
      const patch = JSON.parse(options.body);
      return {
        ok: patchStatus === 200,
        status: patchStatus,
        json: async () => patchBody ?? { session: { ...BLOCKED, ...patch } },
      };
    }
    return { ok: true, json: async () => ({}) };
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('SessionDetailPage — status controls', () => {
  it('clears a block via PATCH { status: running }', async () => {
    const fetchFn = makeFetch();
    global.fetch = fetchFn;
    render(<SessionDetailPage />);

    fireEvent.click(await screen.findByText('Clear block'));

    await waitFor(() => {
      const patch = fetchFn.mock.calls.find((c) => String(c[0]) === '/api/sessions/cs_1' && c[1]?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(patch[1].body).status).toBe('running');
    });
  });

  it('marks a session finished via PATCH { status: finished }', async () => {
    const fetchFn = makeFetch();
    global.fetch = fetchFn;
    render(<SessionDetailPage />);

    fireEvent.click(await screen.findByText('Mark finished'));

    await waitFor(() => {
      const patch = fetchFn.mock.calls.find(
        (c) => String(c[0]) === '/api/sessions/cs_1' && c[1]?.method === 'PATCH' &&
          JSON.parse(c[1].body).status === 'finished',
      );
      expect(patch).toBeTruthy();
    });
  });

  it('surfaces a 409 (closed session) as an error', async () => {
    global.fetch = makeFetch({ patchStatus: 409, patchBody: { error: 'Session is closed and cannot be updated' } });
    render(<SessionDetailPage />);

    fireEvent.click(await screen.findByText('Mark finished'));
    expect(await screen.findByText(/Session is closed and cannot be updated/)).toBeTruthy();
  });
});
