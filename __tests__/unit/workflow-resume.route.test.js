import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

// The resume route runs executeWorkflow synchronously then writes the parent
// action's terminal outcome. A throw inside executeWorkflow must still
// transition the parent off 'running' (so the workflow_stuck signal does not
// fire forever), and the terminal write is gated on running for the same
// cancel-race reason as the execute route.
const h = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  getWorkflowRun: vi.fn(),
  getWorkflowTemplate: vi.fn(),
  buildResumeContext: vi.fn(),
  evaluateGuard: vi.fn(),
  createActionRecord: vi.fn(),
  updateActionOutcome: vi.fn(),
  executeWorkflow: vi.fn(),
  insertStepResult: vi.fn(),
  updateStepResult: vi.fn(),
  createArtifact: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => h.mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));
vi.mock('@/lib/apiErrors.js', () => ({
  apiErrorResponse: () => ({ status: 500, json: async () => ({ error: 'internal' }) }),
}));
vi.mock('@/lib/guard.js', () => ({ evaluateGuard: h.evaluateGuard }));
vi.mock('@/lib/repositories/workflow-templates.repository.js', () => ({ getWorkflowTemplate: h.getWorkflowTemplate }));
vi.mock('@/lib/repositories/workflow-runs.repository.js', () => ({
  getWorkflowRun: h.getWorkflowRun,
  buildResumeContext: h.buildResumeContext,
  insertStepResult: h.insertStepResult,
  updateStepResult: h.updateStepResult,
}));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  createActionRecord: h.createActionRecord,
  updateActionOutcome: h.updateActionOutcome,
}));
vi.mock('@/lib/repositories/artifacts.repository.js', () => ({ createArtifact: h.createArtifact }));
vi.mock('@/lib/workflow-executor.js', () => ({ executeWorkflow: h.executeWorkflow }));

import { POST } from '@/api/workflows/templates/[templateId]/runs/[runActionId]/resume/route.js';

const ctx = { params: Promise.resolve({ templateId: 'wt_1', runActionId: 'act_orig' }) };
function req(body = {}) {
  return makeRequest('http://localhost/api/workflows/templates/wt_1/runs/act_orig/resume', {
    headers: { 'x-org-id': 'org_test' },
    body,
  });
}

describe('POST resume — parent transitions out of running', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getWorkflowRun.mockResolvedValue({
      status: 'failed',
      steps: [{ step_id: 's1', step_index: 0, status: 'failed' }],
      agent_id: 'a',
    });
    h.getWorkflowTemplate.mockResolvedValue({ template_id: 'wt_1', slug: 'demo', name: 'Demo', steps: [{ id: 's1' }] });
    h.buildResumeContext.mockReturnValue({ resumeFromIndex: 0, failedStepId: 's1', priorSteps: {} });
    h.evaluateGuard.mockResolvedValue({ decision: 'allow' });
    h.createActionRecord.mockResolvedValue(undefined);
    h.updateActionOutcome.mockResolvedValue({ action_id: 'x', status: 'completed' });
  });

  it('marks the parent failed (gated) when executeWorkflow throws, then propagates', async () => {
    h.executeWorkflow.mockRejectedValue(new Error('mid-run db fail'));
    const res = await POST(req({}), ctx);
    expect(res.status).toBe(500);
    expect(h.updateActionOutcome).toHaveBeenCalledTimes(1);
    const [, , , fields, opts] = h.updateActionOutcome.mock.calls[0];
    expect(fields.status).toBe('failed');
    expect(opts).toEqual({ gateStatus: 'running' });
  });

  it('gates the terminal write on status=running for the success path', async () => {
    h.executeWorkflow.mockResolvedValue({ success: true, result: {}, total_elapsed_ms: 3, steps: [] });
    const res = await POST(req({}), ctx);
    expect(res.status).toBe(200);
    const [, , , fields, opts] = h.updateActionOutcome.mock.calls[0];
    expect(fields.status).toBe('completed');
    expect(opts).toEqual({ gateStatus: 'running' });
  });
});
