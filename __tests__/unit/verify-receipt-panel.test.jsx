import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/ui/Card.js', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardHeader: ({ title }) => <div>{title}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/Badge.js', () => ({ Badge: ({ children }) => <span>{children}</span> }));

const { default: VerifyReceiptPanel } = await import('@/components/VerifyReceiptPanel.jsx');

afterEach(() => { vi.unstubAllGlobals(); });

describe('VerifyReceiptPanel', () => {
  it('verifies a signed bundle and shows the key id', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, kid: 'key-1' }) }));
    vi.stubGlobal('fetch', fetchFn);

    render(<VerifyReceiptPanel />);
    fireEvent.change(screen.getByLabelText('Receipt or bundle JSON'), { target: { value: '{"payload":{"report":"x"},"signature":{"kid":"key-1"}}' } });
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }));

    expect(await screen.findByText('Verified')).toBeTruthy();
    expect(screen.getByText('key: key-1')).toBeTruthy();
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.bundle).toBeTruthy(); // default type is bundle
  });

  it('shows "Not verified" with the failure reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: false, reason: 'no_matching_key_or_bad_signature' }) })));

    render(<VerifyReceiptPanel />);
    fireEvent.change(screen.getByLabelText('Receipt or bundle JSON'), { target: { value: '{"signature":{"kid":"bad"}}' } });
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }));

    expect(await screen.findByText('Not verified')).toBeTruthy();
    expect(screen.getByText('no_matching_key_or_bad_signature')).toBeTruthy();
  });

  it('wraps the JSON under the selected type (receipt)', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, kid: 'k' }) }));
    vi.stubGlobal('fetch', fetchFn);

    render(<VerifyReceiptPanel />);
    fireEvent.click(screen.getByRole('tab', { name: /proof receipt/i }));
    fireEvent.change(screen.getByLabelText('Receipt or bundle JSON'), { target: { value: '{"signature":{"kid":"k"}}' } });
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }));

    await screen.findByText('Verified');
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.receipt).toBeTruthy();
    expect(body.bundle).toBeUndefined();
  });

  it('blocks invalid JSON without calling the API', () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);

    render(<VerifyReceiptPanel />);
    fireEvent.change(screen.getByLabelText('Receipt or bundle JSON'), { target: { value: 'not json' } });
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }));

    expect(screen.getByText(/Paste valid JSON to verify/i)).toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
