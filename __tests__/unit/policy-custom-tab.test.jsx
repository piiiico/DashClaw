import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// The .js UI primitives contain JSX that Vite's oxc loader won't parse — mock them.
vi.mock('@/components/ui/Badge.js', () => ({
  Badge: ({ children }) => <span>{children}</span>,
}));
vi.mock('@/components/ui/Card.js', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardHeader: ({ title }) => <div>{title}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/EmptyState.js', () => ({
  EmptyState: ({ title, description }) => <div>{title}{description}</div>,
}));

const { default: CustomTab } = await import('@/policies/components/CustomTab.jsx');

const TEMPLATES = [
  {
    id: 'enterprise-strict',
    name: 'Enterprise Strict',
    description: 'Max security',
    recommended_for: 'SOC 2',
    policy_count: 4,
    policies: [{ name: 'Block deploy', policy_type: 'block_action_type', rules_summary: 'action_types: [deploy]' }],
  },
];

const TEST_RESULTS = {
  results: {
    total_policies: 1,
    total_tests: 2,
    passed: 1,
    failed: 1,
    success: false,
    details: [{
      policy_id: 'p1',
      policy_name: 'No prod deploy',
      tests: [
        { name: 'blocks_without_approval', passed: true, expected: false, actual: false, reason: null },
        { name: 'allows_with_approval', passed: false, expected: true, actual: false, reason: 'blocked' },
      ],
    }],
  },
  generated_at: '2026-06-03T00:00:00Z',
};

function mockFetch(overrides = {}) {
  const routes = {
    'GET /api/policies': () => ({ policies: [] }),
    'GET /api/agents': () => ({ agents: [] }),
    'GET /api/policies/templates': () => ({ templates: TEMPLATES }),
    'POST /api/policies/test': () => TEST_RESULTS,
    'GET /api/policies/proof': () => ({ report: '# Proof', format: 'md', generated_at: 'x' }),
    ...overrides,
  };
  return vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    const key = `${method} ${url.split('?')[0]}`;
    const handler = routes[key];
    const body = handler ? handler(url, options) : {};
    return { ok: true, status: 200, json: async () => body };
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('CustomTab — orphaned policy surfaces', () => {
  it('runs the policy test suite and renders per-policy pass/fail results', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<CustomTab />);
    await screen.findByPlaceholderText(/search policies/i);

    fireEvent.click(screen.getByRole('button', { name: /run tests/i }));

    expect(await screen.findByText('No prod deploy')).toBeTruthy();
    expect(screen.getByText('1/2 passed')).toBeTruthy();
    expect(screen.getByText('blocks_without_approval')).toBeTruthy();
    expect(screen.getByText('allows_with_approval')).toBeTruthy();
  });

  it('opens the proof report panel from the actions bar', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<CustomTab />);
    await screen.findByPlaceholderText(/search policies/i);

    fireEvent.click(screen.getByRole('button', { name: /export proof/i }));

    expect(await screen.findByText('Policy proof report')).toBeTruthy();
  });

  it('drives the import pack picker from /api/policies/templates with policy_count + rules_summary', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<CustomTab />);
    await screen.findByPlaceholderText(/search policies/i);
    // templates fetched on mount
    await waitFor(() => {});

    fireEvent.click(screen.getByRole('button', { name: /^import$/i }));

    expect(await screen.findByText(/4 policies/i)).toBeTruthy();
    expect(screen.getByText(/action_types: \[deploy\]/)).toBeTruthy();
  });
});
