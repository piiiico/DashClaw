import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Pins the [H] "Score an action" flow: a profile card's "Score recent" button
// must batch-score real ledger actions via POST /api/scoring/score
// ({profile_id, actions}) and surface the returned summary.

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
  composite_method: 'weighted_average', dimensions: [{ id: 'd1', name: 'Speed', weight: 0.5 }],
};

function makeFetch() {
  return vi.fn(async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
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
