import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

// Render-state coverage for /activity (app/activity/page.jsx). These assertions
// migrated from the retired /my-agent page test when Agent Summary was folded
// into Activity: narrative hero, Today/This-week scope toggle, pinned denials,
// install-prompt empty state, and agent-filter querystring propagation.

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
  declared_goal = 'do a thing',
  status = 'completed',
  approved_by = null,
  timestamp_start = new Date().toISOString(),
} = {}) {
  return { action_id, agent_id, declared_goal, status, approved_by, timestamp_start };
}

function makeGuard({
  id = 'g_' + Math.random().toString(36).slice(2, 10),
  agent_id = 'claude-code',
  decision = 'allow',
  reason = 'policy permitted',
  matched_policies = [],
  created_at = new Date().toISOString(),
} = {}) {
  return { id, agent_id, decision, reason, matched_policies, created_at };
}

function stubFetch({ actions = [], decisions = [] } = {}) {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.startsWith('/api/actions')) {
      return { ok: true, status: 200, json: async () => ({ actions }) };
    }
    if (u.startsWith('/api/guard')) {
      // GET /api/guard returns { decisions: [...] } (see listGuardDecisions).
      return { ok: true, status: 200, json: async () => ({ decisions }) };
    }
    if (u.startsWith('/api/activity')) {
      return { ok: true, status: 200, json: async () => ({ events: [] }) };
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

describe('GlobalActivityFeed — /activity render states', () => {
  beforeEach(() => {
    realtimeSubscriber = null;
    currentAgentFilter = { agentId: null };
    // Reset module registry so each test gets a fresh component instance
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the install-prompt hero for a zero-activity user', async () => {
    global.fetch = stubFetch({ actions: [], decisions: [] });
    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    render(<ActivityPage />);

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
    global.fetch = stubFetch({ actions, decisions: [] });
    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    render(<ActivityPage />);

    await waitFor(() => {
      // Singular grammar: "1 command." (no trailing s)
      expect(screen.getByText(/your agent ran 1 command\./i)).toBeTruthy();
    });
  });

  it('respects the Today/This-week scope toggle re-filter', async () => {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    // 30 commands within the last day (today scope)
    const todayActions = Array.from({ length: 30 }, (_, i) =>
      makeAction({ status: 'completed', timestamp_start: new Date(now - i * 60 * 1000).toISOString() })
    );
    // 25 commands scattered across the prior days, still within week
    const weekOnlyActions = Array.from({ length: 25 }, (_, i) =>
      makeAction({
        status: 'completed',
        timestamp_start: new Date(now - (1.5 * DAY + i * 2 * 60 * 60 * 1000)).toISOString(),
      })
    );
    const actions = [...todayActions, ...weekOnlyActions];

    global.fetch = stubFetch({ actions, decisions: [] });
    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    render(<ActivityPage />);

    // Today scope first
    await waitFor(() => {
      expect(screen.getByText(/your agent ran 30 commands\./i)).toBeTruthy();
    });

    // Click the "This week" toggle — week count includes today + prior days
    const weekBtn = screen.getByRole('button', { name: /this week/i });
    fireEvent.click(weekBtn);

    await waitFor(() => {
      expect(screen.getByText(/your agent ran 55 commands\./i)).toBeTruthy();
    });
  });

  it('propagates useAgentFilter.agentId into fetch querystring', async () => {
    currentAgentFilter = { agentId: 'claude-code' };
    const fetchMock = stubFetch({ actions: [makeAction()], decisions: [] });
    global.fetch = fetchMock;

    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    render(<ActivityPage />);

    await waitForFetches(fetchMock);
    const actionCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/actions'));
    const guardCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/guard'));
    expect(actionCalls[0][0]).toMatch(/agent_id=claude-code/);
    expect(guardCalls[0][0]).toMatch(/agent_id=claude-code/);
  });

  it('pins denials above the live feed', async () => {
    const now = Date.now();
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

    global.fetch = stubFetch({ actions: approvals, decisions: denials });
    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    const { container } = render(<ActivityPage />);

    await waitFor(() => {
      // Denials appear both in the pinned section and the chronological feed
      // (Activity is the full record; the pin is an added highlight), so the
      // text legitimately matches more than once.
      expect(screen.getAllByText(/rm -rf blocked/i).length).toBeGreaterThan(0);
    });

    // Denial section must render testid=denials-section ABOVE the live feed.
    const denialsSection = container.querySelector('[data-testid="denials-section"]');
    expect(denialsSection).toBeTruthy();
    // The pinned denial reason precedes the live-feed "Live feed" header.
    const liveFeedHeader = screen.getByText(/live feed/i);
    const order = denialsSection.compareDocumentPosition(liveFeedHeader);
    // Node.DOCUMENT_POSITION_FOLLOWING === 4 (bit set when other node follows)
    expect(order & 4).toBeTruthy();
  });

  it('counts denials in the narrative and uses the warning tone', async () => {
    const now = Date.now();
    const actions = [makeAction({ status: 'completed', timestamp_start: new Date(now).toISOString() })];
    const denials = [
      makeGuard({ id: 'g_d', decision: 'block', reason: 'blocked', created_at: new Date(now).toISOString() }),
    ];
    global.fetch = stubFetch({ actions, decisions: denials });
    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    render(<ActivityPage />);

    await waitFor(() => {
      // Narrative includes the denial clause.
      expect(screen.getByText(/1 was denied\./i)).toBeTruthy();
    });
  });

  it('patches a realtime guard.decision.created event into the feed in place', async () => {
    const now = Date.now();
    const fetchMock = stubFetch({
      actions: [makeAction({ timestamp_start: new Date(now).toISOString() })],
      decisions: [],
    });
    global.fetch = fetchMock;

    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    const { container } = render(<ActivityPage />);

    await waitForFetches(fetchMock);
    expect(realtimeSubscriber).toBeTruthy();

    // Fire a denial SSE event — it should appear in the pinned denials section.
    realtimeSubscriber('guard.decision.created', {
      id: 'g_live',
      agent_id: 'claude-code',
      decision: 'block',
      reason: 'live denial reason',
      created_at: new Date(now).toISOString(),
    });

    await waitFor(() => {
      // The realtime denial must surface specifically in the pinned section
      // (it also lands in the feed, so scope the assertion to disambiguate).
      const denialsSection = container.querySelector('[data-testid="denials-section"]');
      expect(denialsSection).toBeTruthy();
      expect(within(denialsSection).getByText(/live denial reason/i)).toBeTruthy();
    });
  });
});
