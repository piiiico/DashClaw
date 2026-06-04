import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/messages/_components/MarkdownBody', () => ({ default: ({ content }) => <div>{content}</div> }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ templateId: 'wft_abc', runActionId: 'act_1' }),
}));

vi.mock('@/components/PageLayout.js', () => ({
  default: ({ title, children }) => (
    <div>
      <div data-testid="page-title">{title}</div>
      <div>{children}</div>
    </div>
  ),
}));

function okJson(data) {
  return { ok: true, status: 200, json: async () => data };
}

function notFoundJson() {
  return { ok: false, status: 404, json: async () => ({ error: 'run_not_found' }) };
}

const mockRun = {
  run_action_id: 'act_1',
  template_id: 'wft_abc',
  template_name: 'Research Pipeline',
  status: 'completed',
  agent_id: 'research-agent',
  declared_goal: 'Research x402 protocol',
  duration_ms: 4523,
  started_at: '2026-04-08T12:00:00Z',
  finished_at: '2026-04-08T12:00:04Z',
  error_message: null,
  step_count: 2,
  steps_completed: 2,
  steps_failed: 0,
  steps: [
    {
      step_result_id: 'sr_1',
      step_id: 'search',
      step_index: 0,
      step_type: 'knowledge_search',
      step_name: 'Find docs',
      status: 'completed',
      input: { collection_id: 'kc_1', query: 'x402' },
      output: { chunks: [{ content: 'x402 is a payment protocol' }] },
      error_message: null,
      retry_count: 0,
      duration_ms: 312,
    },
    {
      step_result_id: 'sr_2',
      step_id: 'synthesize',
      step_index: 1,
      step_type: 'prompt',
      step_name: 'Synthesize answer',
      status: 'completed',
      input: { prompt_template: 'Based on: ...' },
      output: { text: 'x402 enables micropayments' },
      error_message: null,
      retry_count: 0,
      duration_ms: 4211,
    },
  ],
};

describe('WorkflowRunDetailPage', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders run metadata and step timeline', async () => {
    global.fetch.mockResolvedValueOnce(okJson(mockRun));

    const { default: WorkflowRunDetailPage } = await import('@/workflows/[templateId]/runs/[runActionId]/page.jsx');

    render(<WorkflowRunDetailPage />);

    const pipelineMatches = await screen.findAllByText('Research Pipeline');
    expect(pipelineMatches.length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('Completed')).toBeTruthy();
    expect(await screen.findByText('Find docs')).toBeTruthy();
    expect(await screen.findByText('Synthesize answer')).toBeTruthy();
  });

  it('shows error state for failed runs', async () => {
    const failedRun = {
      ...mockRun,
      status: 'failed',
      error_message: 'Step search failed: timeout',
      steps: [
        { ...mockRun.steps[0], status: 'failed', error_message: 'timeout' },
      ],
    };
    global.fetch.mockResolvedValueOnce(okJson(failedRun));

    const { default: WorkflowRunDetailPage } = await import('@/workflows/[templateId]/runs/[runActionId]/page.jsx');

    render(<WorkflowRunDetailPage />);

    expect(await screen.findByText('Failed')).toBeTruthy();
    expect(await screen.findByText('Step search failed: timeout')).toBeTruthy();
  });

  it('shows not-found state', async () => {
    global.fetch.mockResolvedValueOnce(notFoundJson());

    const { default: WorkflowRunDetailPage } = await import('@/workflows/[templateId]/runs/[runActionId]/page.jsx');

    render(<WorkflowRunDetailPage />);

    expect(await screen.findByText('This workflow run was not found.')).toBeTruthy();
  });
});
