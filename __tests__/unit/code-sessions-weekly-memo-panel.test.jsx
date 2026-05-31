/**
 * Render tests for WeeklyMemoPanel.
 *
 * Regression guard for a bug that compiled and passed all other gates but
 * rendered nothing: the panel passed the memo Markdown as children
 * (`<MarkdownBody>{body}</MarkdownBody>`) while MarkdownBody reads a `content`
 * prop and returns null otherwise — so the memo body was invisible. These tests
 * assert the body text actually reaches the DOM and the empty state shows a
 * Generate action.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// MarkdownBody lives in a .js file that contains JSX, which the test transformer
// won't parse on direct import. Mock it with a faithful stand-in that mirrors
// the REAL contract: it renders the `content` prop and renders nothing if
// `content` is absent. That contract is the whole point of this regression
// test — the bug was passing the body as children, so `content` was undefined
// and the panel rendered blank. A children-based mock would hide that bug, so
// this mock deliberately ignores children and only honors `content`.
// Mock specifier must match how the panel imports it (a relative path), not the
// @/ alias — vitest resolves mocks against the request string the module uses.
vi.mock('../../app/messages/_components/MarkdownBody.js', () => ({
  default: ({ content }) => (content ? <div data-testid="markdown-body">{content}</div> : null),
}));

import WeeklyMemoPanel from '@/code-sessions/[projectId]/WeeklyMemoPanel.jsx';

afterEach(cleanup);

const MEMO = {
  id: 'm_1',
  iso_week_tag: '2026-W22',
  body_md: '# Weekly Code Sessions memo\n\nTotal spend: **$12.34** this week. A unique-memo-body-marker line.',
  created_at: '2026-05-31T00:00:00.000Z',
};

describe('WeeklyMemoPanel', () => {
  it('renders the memo Markdown body (not blank) when seeded with a memo', () => {
    render(<WeeklyMemoPanel projectId="cp_1" initialMemo={MEMO} />);
    // The body text must actually be in the DOM — this is what the children-vs-
    // content bug broke (MarkdownBody returned null, leaving the body invisible).
    // getByText throws if absent, so a successful return is the assertion; the
    // truthy check keeps it explicit. (Repo doesn't load jest-dom matchers.)
    expect(screen.getByText(/unique-memo-body-marker/)).toBeTruthy();
    // The bold spend figure from the Markdown also renders.
    expect(screen.getByText(/\$12\.34/)).toBeTruthy();
    // Regenerate control is present for an existing memo.
    expect(screen.getByRole('button', { name: /regenerate weekly memo/i })).toBeTruthy();
  });

  it('shows the empty state with a Generate action when there is no memo', () => {
    render(<WeeklyMemoPanel projectId="cp_1" initialMemo={null} />);
    expect(screen.getByText(/no memo yet for this project/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /generate memo/i })).toBeTruthy();
  });
});
