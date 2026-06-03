import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { default: OrgNameEditor } = await import('@/team/components/OrgNameEditor.jsx');

afterEach(() => { vi.unstubAllGlobals(); });

describe('OrgNameEditor', () => {
  it('lets an admin rename the workspace via PATCH /api/orgs/[id]', async () => {
    const onRenamed = vi.fn();
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      calls.push({ url: String(url), body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({ organization: { id: 'org_1', name: 'New Co' } }) };
    }));

    render(<OrgNameEditor orgId="org_1" name="Old Co" isAdmin onRenamed={onRenamed} />);
    fireEvent.click(screen.getByRole('button', { name: /rename workspace/i }));
    fireEvent.change(screen.getByLabelText(/workspace name/i), { target: { value: 'New Co' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onRenamed).toHaveBeenCalledWith('New Co'));
    expect(calls[0].url).toBe('/api/orgs/org_1');
    expect(calls[0].body).toEqual({ name: 'New Co' });
  });

  it('hides the rename control for non-admins', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<OrgNameEditor orgId="org_1" name="Old Co" isAdmin={false} onRenamed={() => {}} />);
    expect(screen.queryByRole('button', { name: /rename workspace/i })).toBeNull();
    expect(screen.getByText('Old Co')).toBeTruthy();
  });
});
