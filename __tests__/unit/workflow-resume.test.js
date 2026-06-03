import { describe, expect, it } from 'vitest';
import { buildResumeContext } from '../../app/lib/repositories/workflow-runs.repository.js';

// buildResumeContext receives steps that getWorkflowRun has already mapped
// through shapeStepResult, so each step carries an already-parsed `output`
// (JSON parsing / malformed handling is shapeStepResult's job, tested in
// workflow-runs.repository.test.js). These fixtures use that shaped shape.

describe('buildResumeContext', () => {
  it('returns resumeFromIndex at first non-completed step', () => {
    const stepResults = [
      { step_id: 'step_1', step_index: 0, status: 'completed', output: { chunks: [] } },
      { step_id: 'step_2', step_index: 1, status: 'completed', output: { text: 'done' } },
      { step_id: 'step_3', step_index: 2, status: 'failed', output: null },
    ];

    const result = buildResumeContext(stepResults);
    expect(result.resumeFromIndex).toBe(2);
    expect(result.failedStepId).toBe('step_3');
    expect(Object.keys(result.priorSteps)).toEqual(['step_1', 'step_2']);
  });

  it('carries the prior shaped step output into priorSteps', () => {
    const stepResults = [
      { step_id: 'step_1', step_index: 0, status: 'completed', output: { answer: 'yes' } },
      { step_id: 'step_2', step_index: 1, status: 'failed', output: null },
    ];

    const result = buildResumeContext(stepResults);
    expect(result.priorSteps.step_1).toEqual({ output: { answer: 'yes' } });
  });

  it('returns null when all steps completed', () => {
    const stepResults = [
      { step_id: 'step_1', step_index: 0, status: 'completed', output: {} },
      { step_id: 'step_2', step_index: 1, status: 'completed', output: {} },
    ];

    const result = buildResumeContext(stepResults);
    expect(result).toBeNull();
  });

  it('returns null when no steps exist', () => {
    const result = buildResumeContext([]);
    expect(result).toBeNull();
  });

  it('respects fromStepId override', () => {
    const stepResults = [
      { step_id: 'step_1', step_index: 0, status: 'completed', output: { a: 1 } },
      { step_id: 'step_2', step_index: 1, status: 'completed', output: { b: 2 } },
      { step_id: 'step_3', step_index: 2, status: 'failed', output: null },
    ];

    // Resume from step_2 (re-run it even though it completed)
    const result = buildResumeContext(stepResults, 'step_2');
    expect(result.resumeFromIndex).toBe(1);
    expect(Object.keys(result.priorSteps)).toEqual(['step_1']);
  });

  it('handles skipped steps in the prior run', () => {
    const stepResults = [
      { step_id: 'step_1', step_index: 0, status: 'completed', output: { x: 1 } },
      { step_id: 'step_2', step_index: 1, status: 'skipped', output: null },
      { step_id: 'step_3', step_index: 2, status: 'failed', output: null },
    ];

    const result = buildResumeContext(stepResults);
    expect(result.resumeFromIndex).toBe(2);
    // skipped steps have no output — not included in priorSteps
    expect(Object.keys(result.priorSteps)).toEqual(['step_1']);
  });

  it('carries a null output through faithfully', () => {
    const stepResults = [
      { step_id: 'step_1', step_index: 0, status: 'completed', output: null },
      { step_id: 'step_2', step_index: 1, status: 'failed', output: null },
    ];

    const result = buildResumeContext(stepResults);
    expect(result.priorSteps.step_1).toEqual({ output: null });
  });
});
