import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// --- Mocks (declared before the target module is imported) ---

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, breadcrumbs }) => (
    <div>
      <h1>{title}</h1>
      {breadcrumbs && <nav aria-label="Breadcrumb">{breadcrumbs.join(' / ')}</nav>}
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children, className }) => <div className={className}>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/EmptyState', () => ({
  EmptyState: ({ title, description, action }) => (
    <div>
      <div>{title}</div>
      {description && <div>{description}</div>}
      {action && <div>{action}</div>}
    </div>
  ),
}));

vi.mock('@/components/ui/Skeleton', () => ({
  Skeleton: ({ className }) => <div className={className} data-testid="skeleton" />,
}));

// useRealtime — capture the subscriber so tests can fire events into the component.
let realtimeSubscriber = null;
vi.mock('../../app/hooks/useRealtime', () => ({
  useRealtime: (handler) => {
    realtimeSubscriber = handler;
  },
}));

// useAgentFilter — tests may re-mock this per case; default to null.
let currentAgentFilter = { agentId: null };
vi.mock('../../app/lib/AgentFilterContext', () => ({
  useAgentFilter: () => currentAgentFilter,
}));

// --- Test fixtures ---

function makeAction({
  action_id = 'act_' + Math.random().toString(36).slice(2, 10),
  agent_id = 'claude-code',
  action_type = 'other',
  declared_goal = 'do a thing',
  status = 'completed',
  risk_score = 20,
  approved_by = null,
  timestamp_start = new Date().toISOString(),
} = {}) {
  return {
    action_id, agent_id, action_type, declared_goal,
    status, risk_score, approved_by, timestamp_start,
  };
}

function makeGuard({
  id = 'g_' + Math.random().toString(36).slice(2, 10),
  action_id = 'act_' + Math.random().toString(36).slice(2, 10),
  agent_id = 'claude-code',
  decision = 'allow',
  reason = 'policy permitted',
  matched_policies = [],
  created_at = new Date().toISOString(),
} = {}) {
  return { id, action_id, agent_id, decision, reason, matched_policies, created_at };
}

function stubFetch({ actions = [], evaluations = [] } = {}) {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.startsWith('/api/actions')) {
      return { ok: true, status: 200, json: async () => ({ actions }) };
    }
    if (u.startsWith('/api/guard')) {
      // GET /api/guard returns { decisions: [...] } (see listGuardDecisions);
      // the stub's `evaluations` arg is the list of guard decisions to return.
      return { ok: true, status: 200, json: async () => ({ decisions: evaluations }) };
    }
    if (u === '/api/session/effective') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, authType: 'local', role: 'admin', isAdmin: true }),
      };
    }
    if (u === '/api/agents') {
      return { ok: true, status: 200, json: async () => ({ agents: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

// Helper — wait for the async fetches to settle and React to commit.
async function waitForFetches(fetchMock, expectedCalls = 2) {
  await waitFor(() => {
    const actionCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/actions'));
    const guardCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/guard'));
    expect(actionCalls.length + guardCalls.length).toBeGreaterThanOrEqual(expectedCalls);
  });
}

// --- Tests ---

describe('MyAgentPage — /my-agent render states', () => {
  beforeEach(() => {
    realtimeSubscriber = null;
    currentAgentFilter = { agentId: null };
    // Reset module registry so each test gets a fresh component instance
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the install-prompt hero for a zero-activity user (D-10)', async () => {
    global.fetch = stubFetch({ actions: [], evaluations: [] });
    const { default: MyAgentPage } = await import('../../app/my-agent/page.jsx');
    render(<MyAgentPage />);

    await waitFor(() => {
      expect(screen.getByText(/your agent hasn't run anything yet/i)).toBeTruthy();
    });
    // 3-step install hero
    expect(screen.getByText(/install the hook/i)).toBeTruthy();
    expect(screen.getByText(/connect discord/i)).toBeTruthy();
    // Link to the full guide
    const guideLink = screen.getByRole('link', { name: /open the full guide|full guide/i });
    expect(guideLink.getAttribute('href')).toBe('/guides/claude-code');
  });

  it('renders the narrative hero with a singular command count for 1 action', async () => {
    const actions = [
      makeAction({ status: 'completed', timestamp_start: new Date().toISOString() }),
    ];
    global.fetch = stubFetch({ actions, evaluations: [] });
    const { default: MyAgentPage } = await import('../../app/my-agent/page.jsx');
    render(<MyAgentPage />);

    await waitFor(() => {
      // Singular grammar: "1 command." (no trailing s)
      expect(screen.getByText(/your agent ran 1 command\./i)).toBeTruthy();
    });
  });

  it('renders correctly at 50+ events and respects the toggle re-filter', async () => {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    // 30 approvals within the last day (today scope)
    const todayActions = Array.from({ length: 30 }, (_, i) =>
      makeAction({ status: 'completed', timestamp_start: new Date(now - i * 60 * 1000).toISOString() })
    );
    // 25 approvals scattered across the prior 6 days (days 2–6), still within week
    const weekOnlyActions = Array.from({ length: 25 }, (_, i) =>
      makeAction({
        status: 'completed',
        // Spread across hours so none collide with the today cutoff, staying
        // strictly inside the week window (t > now - 7*DAY).
        timestamp_start: new Date(now - (1.5 * DAY + i * 2 * 60 * 60 * 1000)).toISOString(),
      })
    );
    const actions = [...todayActions, ...weekOnlyActions];

    global.fetch = stubFetch({ actions, evaluations: [] });
    const { default: MyAgentPage } = await import('../../app/my-agent/page.jsx');
    render(<MyAgentPage />);

    // Today scope first
    await waitFor(() => {
      expect(screen.getByText(/your agent ran 30 commands\./i)).toBeTruthy();
    });

    // Click the "This week" toggle — week count includes today + prior 6 days
    const weekBtn = screen.getByRole('button', { name: /this week/i });
    fireEvent.click(weekBtn);

    await waitFor(() => {
      expect(screen.getByText(/your agent ran 55 commands\./i)).toBeTruthy();
    });
  });

  it('propagates useAgentFilter.agentId into fetch querystring (D-14)', async () => {
    currentAgentFilter = { agentId: 'claude-code' };
    const fetchMock = stubFetch({ actions: [makeAction()], evaluations: [] });
    global.fetch = fetchMock;

    const { default: MyAgentPage } = await import('../../app/my-agent/page.jsx');
    render(<MyAgentPage />);

    await waitForFetches(fetchMock);
    const actionCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/actions'));
    const guardCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/guard'));
    expect(actionCalls[0][0]).toMatch(/agent_id=claude-code/);
    expect(guardCalls[0][0]).toMatch(/agent_id=claude-code/);
  });

  it('pins denials above the chronological list (D-11)', async () => {
    const now = Date.now();
    // 5 approvals (older) + 2 denials (newer by chronology but still pinned first)
    const approvals = Array.from({ length: 5 }, (_, i) =>
      makeAction({
        action_id: `act_approved_${i}`,
        status: 'completed',
        timestamp_start: new Date(now - (i + 1) * 60 * 1000).toISOString(),
        declared_goal: `approved action ${i}`,
      })
    );
    const denials = [
      makeGuard({
        id: 'g_deny_0',
        decision: 'block',
        reason: 'rm -rf blocked',
        matched_policies: [{ name: 'block_destructive_shell' }],
        created_at: new Date(now - 30 * 1000).toISOString(),
      }),
      makeGuard({
        id: 'g_deny_1',
        decision: 'deny',
        reason: 'force push to main',
        matched_policies: [{ name: 'block_force_push' }],
        created_at: new Date(now - 20 * 1000).toISOString(),
      }),
    ];

    global.fetch = stubFetch({ actions: approvals, evaluations: denials });
    const { default: MyAgentPage } = await import('../../app/my-agent/page.jsx');
    const { container } = render(<MyAgentPage />);

    await waitFor(() => {
      expect(screen.getByText(/rm -rf blocked/i)).toBeTruthy();
    });

    // Denial section must render a testid=denials-section ABOVE testid=chrono-section
    const denialsSection = container.querySelector('[data-testid="denials-section"]');
    const chronoSection = container.querySelector('[data-testid="chrono-section"]');
    expect(denialsSection).toBeTruthy();
    expect(chronoSection).toBeTruthy();
    // DocumentPosition: denials should precede chrono
    const order = denialsSection.compareDocumentPosition(chronoSection);
    // Node.DOCUMENT_POSITION_FOLLOWING === 4 (bit set when other node follows)
    expect(order & 4).toBeTruthy();
  });

  it('re-fetches when a realtime action.updated event fires (D-12)', async () => {
    const fetchMock = stubFetch({ actions: [makeAction()], evaluations: [] });
    global.fetch = fetchMock;

    const { default: MyAgentPage } = await import('../../app/my-agent/page.jsx');
    render(<MyAgentPage />);

    await waitForFetches(fetchMock);
    const callsAfterMount = fetchMock.mock.calls.length;
    expect(realtimeSubscriber).toBeTruthy();

    // Simulate an SSE event
    realtimeSubscriber('action.updated', { action_id: 'act_new' });

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterMount);
    });
  });
});
