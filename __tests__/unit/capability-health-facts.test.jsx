import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Pins the capability detail-field surfacing: the health endpoint already
// returns invocation counts, last success/failure, pending approvals, and
// recent errors, and the capability carries pricing.estimated_cost_usd +
// docs_url — none of which the page rendered before.

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
  CardHeader: ({ title }) => <div>{title}</div>,
}));

const { default: CapabilityHealthCards } = await import('@/capabilities/[capabilityId]/components/CapabilityHealthCards.jsx');
const { default: CapabilityFactsCard } = await import('@/capabilities/[capabilityId]/components/CapabilityFactsCard.jsx');

describe('CapabilityHealthCards — invocation detail', () => {
  it('renders invocation counts, pending approvals, and recent errors', () => {
    const health = {
      success_rate_1d: 90, success_rate_7d: 85, p95_latency_ms: 120, stale_check: false,
      total_invocations: 42, successful_invocations: 38, failed_invocations: 4,
      pending_approvals: 2, last_success_at: '2026-06-02T10:00:00Z',
      last_failure_at: '2026-06-01T09:00:00Z',
      recent_errors: [{ message: 'timeout calling upstream', timestamp: '2026-06-01T09:00:00Z' }],
    };
    render(<CapabilityHealthCards health={health} />);

    expect(screen.getByText('Total invocations')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Pending approvals')).toBeTruthy();
    expect(screen.getByText('Last failure')).toBeTruthy();
    expect(screen.getByText('timeout calling upstream')).toBeTruthy();
  });
});

describe('CapabilityFactsCard — pricing + docs_url', () => {
  it('shows estimated cost and a docs link when present', () => {
    const capability = {
      source_type: 'http', auth_type: 'bearer', requires_approval: true,
      pricing: { estimated_cost_usd: 0.0123 }, docs_url: 'https://docs.example.com/cap',
    };
    render(<CapabilityFactsCard capability={capability} health={{ stale_check: false }} />);

    expect(screen.getByText('$0.0123')).toBeTruthy();
    const link = screen.getByText('View docs');
    expect(link.getAttribute('href')).toBe('https://docs.example.com/cap');
  });

  it('omits cost and docs rows when absent', () => {
    const capability = { source_type: 'http', auth_type: 'none', requires_approval: false, pricing: {} };
    render(<CapabilityFactsCard capability={capability} health={{ stale_check: true }} />);

    expect(screen.queryByText('Est. cost / invocation')).toBeNull();
    expect(screen.queryByText('View docs')).toBeNull();
  });
});
