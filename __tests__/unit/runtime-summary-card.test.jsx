import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Pins that RuntimeSummaryCard surfaces the p50 latency and average approval
// wait the /api/operations/summary route returns (previously dropped — only
// p95 + oldest were shown).

const { default: RuntimeSummaryCard } = await import('@/mission-control/components/RuntimeSummaryCard.jsx');

afterEach(() => { vi.unstubAllGlobals(); });

const SUMMARY = {
  throughput: { last_1h: 12 },
  latency: { p95_ms: 2000, p50_ms: 300 },
  approval_backlog: { pending_count: 2, oldest_minutes: 30, avg_wait_minutes: 5 },
  workflows: { completed_24h: 3, failed_24h: 1, running: 0 },
  capabilities: { healthy: 4, degraded: 0, failing: 0 },
};

describe('RuntimeSummaryCard', () => {
  it('renders the p50 latency and average approval wait', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => SUMMARY })));

    render(<RuntimeSummaryCard />);

    expect(await screen.findByText('p50 0.3s')).toBeTruthy();
    expect(screen.getByText(/30m oldest · 5m avg/)).toBeTruthy();
  });
});
