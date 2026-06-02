import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Pins the [H] "Score an action" flow plus the post-creation dimension CRUD
// and calibrate-param wiring: profile cards must batch-score real ledger
// actions, manage dimensions against /profiles/[id]/dimensions[/[dimId]],
// and pass agent_id + metrics to /api/scoring/calibrate.

vi.mock('@/components/PageLayout', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('@/components/ui/Card', () => ({ Card: ({ children }) => <div>{children}</div> }));
vi.mock('@/components/ui/Badge', () => ({ Badge: ({ children }) => <span>{children}</span> }));
vi.mock('@/components/ui/EmptyState', () => ({ EmptyState: ({ title }) => <div>{title}</div> }));
vi.mock('@/lib/isDemoMode', () => ({ isDemoMode: () => false }));
vi.mock('@/lib/demoScoringData', () => ({
  demoScoringProfiles: [], demoRiskTemplates: [], demoScoringScores: [], demoCalibration: null,
}));

const { default: ScoringPage } = await import('@/scoring/page.jsx');

const PROFILE = {
  id: 'sp_1', name: 'Deploy Quality', action_type: 'deploy',
  composite_method: 'weighted_average',
  dimensions: [{ id: 'd1', name: 'Speed', weight: 0.5, data_source: 'duration_ms' }],
};

function makeFetch() {
  return vi.fn(async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
    if (u.includes('/dimensions')) {
      if (method === 'POST') return { ok: true, json: async () => ({ id: 'd_new', name: 'Cost', weight: 0.3, data_source: 'cost_estimate' }) };
      if (method === 'DELETE') return { ok: true, json: async () => ({ deleted: true }) };
      if (method === 'PATCH') return { ok: true, json: async () => ({ id: 'd1', name: 'Speed', weight: 0.6, data_source: 'duration_ms' }) };
    }
    if (u.startsWith('/api/scoring/calibrate')) return { ok: true, json: async () => ({ status: 'insufficient_data', message: 'Need at least 10', count: 0, suggestions: [] }) };
    if (u.startsWith('/api/scoring/profiles')) return { ok: true, json: async () => ({ profiles: [PROFILE] }) };
    if (u.startsWith('/api/scoring/risk-templates')) return { ok: true, json: async () => ({ templates: [] }) };
    if (u.startsWith('/api/scoring/score') && method === 'GET') return { ok: true, json: async () => ({ scores: [] }) };
    if (u.startsWith('/api/actions')) return { ok: true, json: async () => ({ actions: [{ action_id: 'act_1', agent_id: 'a1', risk_score: 10 }, { action_id: 'act_2', agent_id: 'a1' }] }) };
    if (u === '/api/scoring/score' && method === 'POST') return { ok: true, json: async () => ({ results: [], summary: { total: 2, scored: 2, avg_score: 78 } }) };
    return { ok: true, json: async () => ({}) };
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('ScoringPage — Score recent', () => {
  it('batch-scores recent actions against a profile and shows the summary', async () => {
    const fetchFn = makeFetch();
    global.fetch = fetchFn;
    render(<ScoringPage />);

    expect(await screen.findByText('Deploy Quality')).toBeTruthy();
    fireEvent.click(screen.getByText('Score recent'));

    expect(await screen.findByText(/Scored 2\/2 recent actions · avg 78/)).toBeTruthy();

    const post = fetchFn.mock.calls.find((c) => c[0] === '/api/scoring/score' && c[1]?.method === 'POST');
    const body = JSON.parse(post[1].body);
    expect(body.profile_id).toBe('sp_1');
    expect(body.actions).toHaveLength(2);
    // recent actions were scoped to the profile's action_type
    expect(fetchFn.mock.calls.some((c) => String(c[0]).includes('action_type=deploy'))).toBe(true);
  });
});

describe('ScoringPage — dimension CRUD', () => {
  it('adds a dimension to an existing profile via POST /profiles/[id]/dimensions', async () => {
    const fetchFn = makeFetch();
    global.fetch = fetchFn;
    render(<ScoringPage />);

    expect(await screen.findByText('Deploy Quality')).toBeTruthy();
    fireEvent.click(screen.getByText('Manage dims'));

    const nameInput = await screen.findByLabelText('New dimension name');
    fireEvent.change(nameInput, { target: { value: 'Cost' } });
    fireEvent.click(screen.getByText('+ Add dimension'));

    await waitFor(() => {
      const post = fetchFn.mock.calls.find(
        (c) => String(c[0]) === '/api/scoring/profiles/sp_1/dimensions' && c[1]?.method === 'POST',
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(post[1].body);
      expect(body.name).toBe('Cost');
      expect(body.data_source).toBe('duration_ms');
      expect(typeof body.weight).toBe('number');
    });
  });

  it('deletes a dimension via DELETE /profiles/[id]/dimensions/[dimId]', async () => {
    const fetchFn = makeFetch();
    global.fetch = fetchFn;
    render(<ScoringPage />);

    expect(await screen.findByText('Deploy Quality')).toBeTruthy();
    fireEvent.click(screen.getByText('Manage dims'));
    fireEvent.click(await screen.findByLabelText('Delete Speed'));

    await waitFor(() => {
      expect(fetchFn.mock.calls.some(
        (c) => String(c[0]) === '/api/scoring/profiles/sp_1/dimensions/d1' && c[1]?.method === 'DELETE',
      )).toBe(true);
    });
  });
});

describe('ScoringPage — calibrate params', () => {
  it('passes agent_id and the selected metrics to POST /api/scoring/calibrate', async () => {
    const fetchFn = makeFetch();
    global.fetch = fetchFn;
    render(<ScoringPage />);

    expect(await screen.findByText('Deploy Quality')).toBeTruthy();
    fireEvent.click(screen.getByText('Calibrate'));

    fireEvent.change(await screen.findByPlaceholderText(/Agent ID/), { target: { value: 'agent-7' } });
    fireEvent.click(screen.getByText('confidence')); // toggle this metric off
    fireEvent.click(screen.getByText('Analyze Data'));

    await waitFor(() => {
      const post = fetchFn.mock.calls.find(
        (c) => String(c[0]) === '/api/scoring/calibrate' && c[1]?.method === 'POST',
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(post[1].body);
      expect(body.agent_id).toBe('agent-7');
      expect(body.metrics).toContain('duration_ms');
      expect(body.metrics).not.toContain('confidence');
    });
  });
});
