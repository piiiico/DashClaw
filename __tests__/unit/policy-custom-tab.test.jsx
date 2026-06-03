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
// The draft editor renders the full guided authoring panel; this test exercises
// the generate -> refine -> save LOOP in CustomTab, not the editor internals, so
// stub it down to the save affordance it exposes.
vi.mock('@/policies/components/PolicyGeneratedDraftEditor.jsx', () => ({
  default: ({ onSave, saveDisabled }) => (
    <button type="button" onClick={onSave} disabled={saveDisabled}>Create Policy</button>
  ),
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

describe('CustomTab — AI generator loop', () => {
  it('clarifies instead of dead-ending, then refines into a saveable draft', async () => {
    let genCall = 0;
    const fetchMock = mockFetch({
      'POST /api/policies/generate': () => {
        genCall += 1;
        // First pass: no draft yet — a clarifying question, never a dead-end.
        if (genCall === 1) {
          return {
            drafts: [],
            assumptions: [],
            clarifications: [
              { id: 'path', question: 'Which path should be protected?', field: 'rules.paths', suggestions: ['.env', 'secrets/'], multi: false },
            ],
            warnings: [],
          };
        }
        // After the user answers: one concrete protected_path draft.
        return {
          drafts: [
            { name: 'Protect .env', policy_type: 'protected_path', rules: { paths: ['.env'], on_violation: 'block' }, confidence: 0.9 },
          ],
          assumptions: [],
          clarifications: [],
          warnings: [],
        };
      },
      'POST /api/policies': () => ({ policy: { id: 'pol_new' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CustomTab />);
    await screen.findByPlaceholderText(/search policies/i);

    // Open the AI generator and describe an intent.
    fireEvent.click(screen.getByRole('button', { name: /ai generator/i }));
    const textarea = await screen.findByPlaceholderText(/stop my agents from deleting/i);
    fireEvent.change(textarea, { target: { value: 'protect my files' } });
    fireEvent.click(screen.getByRole('button', { name: /^generate$/i }));

    // First pass: a clarification chip appears and there is NO dead-end error.
    expect(await screen.findByText(/which path should be protected/i)).toBeTruthy();
    expect(screen.queryByText(/couldn't draft a policy/i)).toBeNull();

    // Answer the clarification and refine.
    fireEvent.click(screen.getByRole('button', { name: '.env' }));
    fireEvent.click(screen.getByRole('button', { name: /refine with my answers/i }));

    // Second pass: the review-and-save editor appears.
    expect(await screen.findByText(/review & save/i)).toBeTruthy();

    // Save the reviewed draft — POST /api/policies fires and success is reported.
    fireEvent.click(screen.getByRole('button', { name: /create policy/i }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url, opts]) => url === '/api/policies' && opts?.method === 'POST'),
      ).toBe(true);
    });
    expect(await screen.findByText(/created policy "Protect \.env"/i)).toBeTruthy();
  });

  it('warns instead of silently dropping when a compound request yields multiple drafts', async () => {
    const fetchMock = mockFetch({
      // Defense-in-depth: even though the prompt asks for one draft, if the model
      // returns several, the UI must surface it (only the first is editable).
      'POST /api/policies/generate': () => ({
        drafts: [
          { name: 'Protect .env', policy_type: 'protected_path', rules: { paths: ['.env'], on_violation: 'block' }, confidence: 0.9 },
          { name: 'Protect secrets', policy_type: 'protected_path', rules: { paths: ['secrets/'], on_violation: 'block' }, confidence: 0.8 },
        ],
        assumptions: [],
        clarifications: [],
        warnings: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CustomTab />);
    await screen.findByPlaceholderText(/search policies/i);

    fireEvent.click(screen.getByRole('button', { name: /ai generator/i }));
    const textarea = await screen.findByPlaceholderText(/stop my agents from deleting/i);
    fireEvent.change(textarea, { target: { value: 'block deploys and protect .env' } });
    fireEvent.click(screen.getByRole('button', { name: /^generate$/i }));

    // The multi-draft warning names the count and the surviving (first) draft.
    expect(await screen.findByText(/generated 2 policies from one request/i)).toBeTruthy();
    expect(screen.getByText(/showing the first \("Protect \.env"\)/i)).toBeTruthy();
    // The first draft is still saveable (no dead-end).
    expect(screen.getByText(/review & save/i)).toBeTruthy();
  });
});
