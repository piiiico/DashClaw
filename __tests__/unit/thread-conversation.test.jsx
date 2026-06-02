import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Pins the resolve-thread / edit-summary controls: the thread header must
// PATCH /api/messages/threads with { thread_id, status } to resolve/reopen and
// { thread_id, summary } to set a summary, and notify the parent via
// onThreadUpdated. Threads used to accumulate permanently "open" with no UI.

vi.mock('@/lib/isDemoMode', () => ({ isDemoMode: () => false }));
vi.mock('@/components/ui/Badge', () => ({ Badge: ({ children }) => <span>{children}</span> }));
vi.mock('@/messages/_components/MarkdownBody', () => ({ default: ({ content }) => <div>{content}</div> }));
vi.mock('@/messages/_components/AttachmentChips', () => ({ default: () => null }));

// jsdom doesn't implement scrollIntoView (the component auto-scrolls on mount).
window.HTMLElement.prototype.scrollIntoView = vi.fn();

const { default: ThreadConversation } = await import('@/messages/_components/ThreadConversation.jsx');

const THREAD = { id: 'mt_1', name: 'Incident sync', status: 'open', summary: '', participants: '[]', message_count: 0 };

function makeFetch() {
  return vi.fn(async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
    if (method === 'PATCH' && u === '/api/messages/threads') {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ thread: { id: 'mt_1', status: body.status ?? 'open', summary: body.summary ?? '' } }),
      };
    }
    if (method === 'GET' && u.startsWith('/api/messages')) {
      return { ok: true, json: async () => ({ messages: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('ThreadConversation — resolve / summary', () => {
  it('resolves the thread via PATCH and notifies the parent', async () => {
    const fetchFn = makeFetch();
    global.fetch = fetchFn;
    const onThreadUpdated = vi.fn();
    render(<ThreadConversation thread={THREAD} onThreadUpdated={onThreadUpdated} />);

    fireEvent.click(await screen.findByText('Resolve thread'));

    await waitFor(() => {
      const patch = fetchFn.mock.calls.find(
        (c) => String(c[0]) === '/api/messages/threads' && c[1]?.method === 'PATCH',
      );
      expect(patch).toBeTruthy();
      const body = JSON.parse(patch[1].body);
      expect(body.thread_id).toBe('mt_1');
      expect(body.status).toBe('resolved');
    });
    await waitFor(() => expect(onThreadUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved' })));
    // header flips to "Reopen"
    expect(await screen.findByText('Reopen')).toBeTruthy();
  });

  it('saves an edited summary via PATCH', async () => {
    const fetchFn = makeFetch();
    global.fetch = fetchFn;
    render(<ThreadConversation thread={THREAD} />);

    fireEvent.click(await screen.findByText('Add summary'));
    fireEvent.change(screen.getByLabelText('Thread summary'), { target: { value: 'Root cause found' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      const patch = fetchFn.mock.calls.find(
        (c) => String(c[0]) === '/api/messages/threads' && c[1]?.method === 'PATCH' &&
          JSON.parse(c[1].body).summary !== undefined,
      );
      expect(patch).toBeTruthy();
      expect(JSON.parse(patch[1].body).summary).toBe('Root cause found');
    });
  });
});
