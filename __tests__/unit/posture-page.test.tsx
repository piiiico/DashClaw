import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

// Mock the heavy app shell so the test focuses on the posture surface.
vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, actions }: { title?: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode }) => (
    <div><h1>{title}</h1><div>{actions}</div><div>{children}</div></div>
  ),
}));

import PosturePage from '@/posture/page';

const POSTURE = {
  score: 72,
  status: 'needs_attention' as const,
  cappedBy: null,
  dimensions: [
    { dimension: 'identity', score: 88, weight: 10 },
    { dimension: 'enforcement', score: 61, weight: 20 },
    { dimension: 'spend', score: 45, weight: 8 },
    { dimension: 'auditability', score: 90, weight: 2 },
    { dimension: 'approval', score: 78, weight: 6 },
    { dimension: 'data_protection', score: 70, weight: 4 },
  ],
  summary: { totalUnits: 8, openFindings: 2, pointsRecoverable: 9 },
  snapshots: [{ score: 72, createdAt: 't2' }, { score: 65, createdAt: 't1' }],
  snapshotTs: 't2',
};

const FINDINGS = {
  findings: [
    { key: 'f-big', dimension: 'spend', severity: 'critical', title: 'x402 calls have no spend limit', evidence: { observedCount: 142, exampleActionIds: [] }, scoreDelta: 6, fix: { type: 'create_policy_draft', policyType: 'x402_spend_limit', rules: { max_spend_usd: 0 } }, status: 'open' },
    { key: 'f-small', dimension: 'enforcement', severity: 'high', title: 'Destructive deploys reach allow', evidence: { observedCount: 38, exampleActionIds: [] }, scoreDelta: 3, fix: { type: 'create_policy_draft', policyType: 'risk_threshold', rules: { threshold: 50 } }, status: 'open' },
  ],
  riskAccepted: [
    { key: 'f-acc', dimension: 'identity', severity: 'low', title: 'Legacy agent unbound', evidence: { observedCount: 1, exampleActionIds: [] }, scoreDelta: 1, fix: { type: 'create_policy_draft', policyType: 'risk_threshold', rules: {} }, status: 'accepted_risk' },
  ],
  counts: { open: 2, drafted: 0, snoozed: 0, accepted_risk: 1, resolved: 0, total: 3 },
};

let resolveCalls: Array<{ url: string; body: any }>;

function makeFetch(postureOverride?: typeof POSTURE) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u === '/api/posture') return { ok: true, json: async () => (postureOverride ?? POSTURE) };
    if (u === '/api/posture/findings') return { ok: true, json: async () => FINDINGS };
    if (u.includes('/resolve') && method === 'POST') {
      resolveCalls.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) });
      return { ok: true, json: async () => ({ resolved: true, status: 'drafted' }) };
    }
    if (u === '/api/posture/scan' && method === 'POST') return { ok: true, json: async () => ({ score: 72 }) };
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

beforeEach(() => {
  resolveCalls = [];
  vi.stubGlobal('fetch', makeFetch());
});
afterEach(() => { vi.restoreAllMocks(); });

describe('/posture page', () => {
  it('renders the score hero (score + status word)', async () => {
    render(<PosturePage />);
    await waitFor(() => expect(screen.getByText('72')).toBeTruthy());
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('/ 100')).toBeTruthy();
  });

  it('renders six dimension cards with their scores', async () => {
    render(<PosturePage />);
    await waitFor(() => expect(screen.getByText('Spend')).toBeTruthy());
    for (const label of ['Identity', 'Enforcement', 'Spend', 'Audit', 'Approval', 'Data']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('45')).toBeTruthy(); // spend
    expect(screen.getByText('88')).toBeTruthy(); // identity
  });

  it('flags only weak dimensions (score < 70) with the attention treatment', async () => {
    const { container } = render(<PosturePage />);
    await waitFor(() => expect(screen.getByText('Spend')).toBeTruthy());
    const card = (label: string) => screen.getByText(label).closest('[data-attention]');
    expect(card('Spend')!.getAttribute('data-attention')).toBe('true');       // 45 -> attention
    expect(card('Enforcement')!.getAttribute('data-attention')).toBe('true');  // 61 -> attention
    expect(card('Identity')!.getAttribute('data-attention')).toBe('false');    // 88 -> calm
    expect(card('Approval')!.getAttribute('data-attention')).toBe('false');    // 78 -> calm
    expect(container.querySelectorAll('[data-attention="true"]').length).toBe(2);
  });

  it('renders the queue ordered by scoreDelta (highest first)', async () => {
    const { container } = render(<PosturePage />);
    await waitFor(() => expect(screen.getByText('x402 calls have no spend limit')).toBeTruthy());
    const titles = Array.from(container.querySelectorAll('span')).map((s) => s.textContent);
    expect(titles.indexOf('x402 calls have no spend limit')).toBeLessThan(titles.indexOf('Destructive deploys reach allow'));
  });

  it('surfaces the risk-accepted ledger', async () => {
    render(<PosturePage />);
    // 'Risk accepted' appears as both the ledger header and the item badge — assert the unique item title.
    await waitFor(() => expect(screen.getByText('Legacy agent unbound')).toBeTruthy());
    expect(screen.getAllByText('Risk accepted').length).toBeGreaterThanOrEqual(1);
  });

  it('create_draft calls the resolve endpoint and the on-page score does NOT move (honesty property)', async () => {
    render(<PosturePage />);
    await waitFor(() => expect(screen.getByText('x402 calls have no spend limit')).toBeTruthy());
    expect(screen.getByText('72')).toBeTruthy();

    // Open the resolve modal for the top finding.
    fireEvent.click(screen.getAllByText('Review fix')[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/does/i)).toBeTruthy(); // honesty note present

    fireEvent.click(within(dialog).getByText('Create draft'));

    await waitFor(() => expect(resolveCalls.length).toBe(1));
    expect(resolveCalls[0]!.url).toContain('/api/posture/findings/f-big/resolve');
    expect(resolveCalls[0]!.body.action).toBe('create_draft');

    // After the refetch, the score is unchanged — drafting never moves the number.
    await waitFor(() => expect(screen.getByText('72')).toBeTruthy());
  });
});
