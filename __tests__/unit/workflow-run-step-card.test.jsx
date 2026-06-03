import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { default: WorkflowRunStepCard } = await import('@/workflows/[templateId]/runs/[runActionId]/components/WorkflowRunStepCard.jsx');

const failedStep = { step_id: 'step_2', step_name: 'Send email', step_type: 'capability_invoke', status: 'failed' };
const completedStep = { step_id: 'step_1', step_name: 'Lookup', step_type: 'knowledge_search', status: 'completed' };

describe('WorkflowRunStepCard — per-step resume', () => {
  it('offers "Resume from here" on a non-completed step of a failed run and passes the step_id', () => {
    const onResumeFromStep = vi.fn();
    render(<WorkflowRunStepCard step={failedStep} runStatus="failed" onResumeFromStep={onResumeFromStep} />);

    fireEvent.click(screen.getByRole('button', { name: /resume from here/i }));
    expect(onResumeFromStep).toHaveBeenCalledWith('step_2');
  });

  it('does not offer resume on a completed step', () => {
    render(<WorkflowRunStepCard step={completedStep} runStatus="failed" onResumeFromStep={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /resume from here/i })).toBeNull();
  });

  it('does not offer resume when the run has not failed', () => {
    render(<WorkflowRunStepCard step={{ ...failedStep, status: 'pending' }} runStatus="running" onResumeFromStep={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /resume from here/i })).toBeNull();
  });
});
