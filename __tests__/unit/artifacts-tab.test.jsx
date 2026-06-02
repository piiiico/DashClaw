import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Pins the evidence-bundle fix: the returned bundle is surfaced (was discarded)
// and failures are shown (the handler previously swallowed errors in catch {}).

const { default: ArtifactsTab } = await import('@/components/ArtifactsTab.jsx');

afterEach(() => { vi.unstubAllGlobals(); });

describe('ArtifactsTab — evidence bundle', () => {
  it('surfaces the returned bundle summary on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if ((options.method || 'GET') === 'POST') {
        return { ok: true, status: 200, json: async () => ({ action: { action_id: 'act_1' }, steps: [1, 2], artifacts: [1], generated_at: '2026-06-02T00:00:00Z' }) };
      }
      return { ok: true, status: 200, json: async () => ({ artifacts: [] }) };
    }));

    render(<ArtifactsTab actionId="act_1" />);
    fireEvent.click(await screen.findByRole('button', { name: /generate evidence bundle/i }));

    expect(await screen.findByText(/Evidence bundle generated — 2 steps, 1 artifact/)).toBeTruthy();
  });

  it('surfaces an error instead of silently swallowing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if ((options.method || 'GET') === 'POST') {
        return { ok: false, status: 404, json: async () => ({ error: 'action_not_found' }) };
      }
      return { ok: true, status: 200, json: async () => ({ artifacts: [] }) };
    }));

    render(<ArtifactsTab actionId="act_1" />);
    fireEvent.click(await screen.findByRole('button', { name: /generate evidence bundle/i }));

    expect(await screen.findByText('Action not found.')).toBeTruthy();
  });
});
