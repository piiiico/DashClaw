import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Badge/Stat/ProgressBar/EmptyState are .js files containing JSX, which the
// vitest loader cannot transform — mock them. The @ alias and the component's
// relative import resolve to the same module, so the mock intercepts both.
vi.mock('@/components/ui/Badge.js', () => ({ Badge: ({ children }) => <span>{children}</span> }));
vi.mock('@/components/ui/Stat.js', () => ({
  StatCompact: ({ label, value }) => <div><span>{label}</span><span>{String(value)}</span></div>,
}));
vi.mock('@/components/ui/ProgressBar.js', () => ({
  ProgressBar: ({ value }) => <div data-testid="bar" data-value={value} />,
}));
vi.mock('@/components/ui/EmptyState.js', () => ({
  EmptyState: ({ title, description, action }) => <div><span>{title}</span><span>{description}</span>{action}</div>,
}));

const { default: AgentReputation } = await import('@/agents/[agentId]/components/AgentReputation.jsx');

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Neon returns numeric columns as strings; the component must coerce + scale 0..1 -> %.
const SUMMARY_FIXTURE = {
  agent_id: 'deploy-bot',
  reliability_score: '0.92',
  completion_rate: '0.80',
  approval_adherence: '0.50',
  quality_score: '0.30',
  policy_violation_rate: '0.10',
  risk_score: '0.20',
  volume_weight: '1',
  confidence: '0.75',
  total_events: '42',
  last_event_at: '2026-06-01T00:00:00Z',
  computed_at: '2026-06-01T00:00:00Z',
  is_active: true,
};

function summaryResponse(summary) {
  return { ok: true, status: 200, json: async () => ({ agent_id: summary.agent_id, summary }) };
}

describe('AgentReputation', () => {
  it('renders metric tiles from a summary, coercing numeric strings to percentages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => summaryResponse(SUMMARY_FIXTURE)));

    render(<AgentReputation agentId="deploy-bot" />);

    // 0.92 -> 92%, 0.80 -> 80%, 0.50 -> 50%, 0.30 -> 30%
    expect(await screen.findByText('92%')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('30%')).toBeTruthy();
    // total_events string coerced to a number, confidence scaled
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
    // is_active badge
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('keys the fetch on the route agentId (URL-encoded)', async () => {
    const fetchFn = vi.fn(async () => summaryResponse(SUMMARY_FIXTURE));
    vi.stubGlobal('fetch', fetchFn);

    render(<AgentReputation agentId="team/deploy bot" />);
    await screen.findByText('92%');

    expect(fetchFn.mock.calls[0][0]).toBe('/api/reputation/agents/team%2Fdeploy%20bot/summary');
  });

  it('shows the "No reputation computed yet" empty state on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'Agent not found' }) })));

    render(<AgentReputation agentId="ghost" />);

    expect(await screen.findByText('No reputation computed yet')).toBeTruthy();
  });

  it('POSTs recompute then re-fetches the summary', async () => {
    const fetchFn = vi.fn(async (url, opts) => {
      const u = String(url);
      if (u.endsWith('/recompute')) {
        return { ok: true, status: 200, json: async () => ({ agent_id: 'deploy-bot', recomputed_at: 'now' }) };
      }
      return summaryResponse(SUMMARY_FIXTURE);
    });
    vi.stubGlobal('fetch', fetchFn);

    render(<AgentReputation agentId="deploy-bot" />);
    await screen.findByText('92%');

    fireEvent.click(screen.getByRole('button', { name: /recompute reputation/i }));

    await waitFor(() => {
      const recomputeCall = fetchFn.mock.calls.find(
        (c) => String(c[0]).endsWith('/recompute') && c[1]?.method === 'POST',
      );
      expect(recomputeCall).toBeTruthy();
    });

    // After recompute, the summary endpoint is hit again (initial + post-recompute re-fetch).
    const summaryCalls = fetchFn.mock.calls.filter((c) => String(c[0]).endsWith('/summary'));
    expect(summaryCalls.length).toBeGreaterThanOrEqual(2);
  });
});
