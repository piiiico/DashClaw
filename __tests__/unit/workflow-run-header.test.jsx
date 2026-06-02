import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({ default: ({ href, children }) => <a href={href}>{children}</a> }));

const { default: WorkflowRunHeader } = await import('@/workflows/[templateId]/runs/[runActionId]/components/WorkflowRunHeader.jsx');

const baseRun = { template_name: 'Refund flow', run_action_id: 'act_1', steps_completed: 1, step_count: 3 };

describe('WorkflowRunHeader', () => {
  it('offers Cancel run for a running run and calls onCancel', () => {
    const onCancel = vi.fn();
    render(<WorkflowRunHeader run={{ ...baseRun, status: 'running' }} templateId="wft_1" onCancel={onCancel} cancelling={false} />);

    const btn = screen.getByRole('button', { name: /cancel run/i });
    fireEvent.click(btn);
    expect(onCancel).toHaveBeenCalled();
  });

  it('does not offer Cancel for a completed run', () => {
    render(<WorkflowRunHeader run={{ ...baseRun, status: 'completed' }} templateId="wft_1" onCancel={vi.fn()} cancelling={false} />);
    expect(screen.queryByRole('button', { name: /cancel run/i })).toBeNull();
    expect(screen.getByText('Completed')).toBeTruthy();
  });

  it('renders a Cancelled badge', () => {
    render(<WorkflowRunHeader run={{ ...baseRun, status: 'cancelled' }} templateId="wft_1" />);
    expect(screen.getByText('Cancelled')).toBeTruthy();
  });
});
