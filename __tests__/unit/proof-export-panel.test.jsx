import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { default: ProofExportPanel } = await import('@/policies/components/ProofExportPanel.jsx');

function mockFetch(routes) {
  return vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    const key = `${method} ${url.split('?')[0]}`;
    const handler = routes[key];
    const body = handler ? handler(url, options) : {};
    return { ok: true, status: 200, json: async () => body };
  });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('ProofExportPanel', () => {
  it('fetches the markdown proof report on open and renders it', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'GET /api/policies/proof': () => ({ report: '# Policy Proof\nactive policies: 3', format: 'md', generated_at: '2026-06-03T00:00:00Z' }),
    }));

    render(<ProofExportPanel open onClose={() => {}} />);

    expect(await screen.findByDisplayValue(/# Policy Proof/)).toBeTruthy();
  });

  it('renders nothing when closed', () => {
    vi.stubGlobal('fetch', mockFetch({}));
    const { container } = render(<ProofExportPanel open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('re-fetches as JSON when the format toggle is switched', async () => {
    const fetchSpy = mockFetch({
      'GET /api/policies/proof': (url) => (
        url.includes('format=json')
          ? { report: '{"policies":3}', format: 'json', generated_at: 'x' }
          : { report: '# md', format: 'md', generated_at: 'x' }
      ),
    });
    vi.stubGlobal('fetch', fetchSpy);

    render(<ProofExportPanel open onClose={() => {}} />);
    await screen.findByDisplayValue(/# md/);

    fireEvent.click(screen.getByRole('button', { name: /json/i }));

    expect(await screen.findByDisplayValue(/"policies":3/)).toBeTruthy();
    expect(fetchSpy.mock.calls.some(([u]) => u.includes('format=json'))).toBe(true);
  });

  it('copies the report to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    vi.stubGlobal('fetch', mockFetch({
      'GET /api/policies/proof': () => ({ report: 'PROOF-BODY', format: 'md', generated_at: 'x' }),
    }));

    render(<ProofExportPanel open onClose={() => {}} />);
    await screen.findByDisplayValue('PROOF-BODY');

    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('PROOF-BODY'));
  });

  it('downloads the report as a file', async () => {
    const createObjectURL = vi.fn(() => 'blob:proof');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    vi.stubGlobal('fetch', mockFetch({
      'GET /api/policies/proof': () => ({ report: 'PROOF-BODY', format: 'md', generated_at: 'x' }),
    }));

    render(<ProofExportPanel open onClose={() => {}} />);
    await screen.findByDisplayValue('PROOF-BODY');

    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });
});
