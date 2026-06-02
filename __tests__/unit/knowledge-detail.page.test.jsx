import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Pins the knowledge collection edit flow: the detail page's "Edit" control
// must reveal a form that PATCHes /api/knowledge/collections/[id] with the
// updated name/description/source_type/tags — the list-page pencil used to
// dead-end here read-only. Also asserts created/updated timestamps render.

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ collectionId: 'kc_1' }),
}));

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, actions }) => (
    <div><h1>{title}</h1><div>{actions}</div><div>{children}</div></div>
  ),
}));

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
  CardHeader: ({ title }) => <div>{title}</div>,
}));

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children }) => <span>{children}</span>,
}));

const { default: KnowledgeCollectionDetailPage } = await import('@/knowledge/[collectionId]/page.jsx');

const COLLECTION = {
  collection_id: 'kc_1', name: 'Runbook library', description: 'Incident runbooks',
  source_type: 'files', tags: ['ops', 'oncall'], ingestion_status: 'synced',
  doc_count: 2, last_synced_at: '2026-06-01T00:00:00Z',
  created_at: '2026-05-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
};

function makeFetch() {
  return vi.fn(async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
    if (u === '/api/knowledge/collections/kc_1' && method === 'GET') {
      return { ok: true, json: async () => ({ collection: COLLECTION }) };
    }
    if (u === '/api/knowledge/collections/kc_1/items') {
      return { ok: true, json: async () => ({ items: [] }) };
    }
    if (u === '/api/knowledge/collections/kc_1' && method === 'PATCH') {
      const patch = JSON.parse(options.body);
      return { ok: true, json: async () => ({ collection: { ...COLLECTION, ...patch } }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('KnowledgeCollectionDetailPage — edit', () => {
  it('PATCHes the collection with the edited fields', async () => {
    const fetchFn = makeFetch();
    global.fetch = fetchFn;
    render(<KnowledgeCollectionDetailPage />);

    // wait for the load — the edit form input is seeded from the collection
    await waitFor(() => expect(screen.getByText('Edit')).toBeTruthy());
    fireEvent.click(screen.getByText('Edit'));

    const nameInput = await screen.findByDisplayValue('Runbook library');
    fireEvent.change(nameInput, { target: { value: 'Renamed library' } });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => {
      const patch = fetchFn.mock.calls.find(
        (c) => String(c[0]) === '/api/knowledge/collections/kc_1' && c[1]?.method === 'PATCH',
      );
      expect(patch).toBeTruthy();
      const body = JSON.parse(patch[1].body);
      expect(body.name).toBe('Renamed library');
      expect(body.source_type).toBe('files');
      expect(body.tags).toEqual(['ops', 'oncall']);
    });
  });

  it('shows created and updated timestamps', async () => {
    global.fetch = makeFetch();
    render(<KnowledgeCollectionDetailPage />);
    await waitFor(() => expect(screen.getByText(/Created/)).toBeTruthy());
    expect(screen.getByText(/Updated/)).toBeTruthy();
  });
});
