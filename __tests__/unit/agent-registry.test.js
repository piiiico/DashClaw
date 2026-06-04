import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqlMock } from '../helpers.js';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getRegisteredAgent: vi.fn(),
    isCapabilityGrouped: vi.fn(),
    recordInvocation: vi.fn(async () => ({})),
    prepareCapabilityInvocation: vi.fn(),
    executeCapabilityInvocation: vi.fn(),
    evaluateGuard: vi.fn(),
    createActionRecord: vi.fn(async () => ({})),
    createBlockedActionRecord: vi.fn(async () => ({})),
    updateActionOutcome: vi.fn(async () => ({})),
    getPredictiveRisk: vi.fn(async () => ({ total_adjustment: 0 })),
  },
}));

vi.mock('@/lib/repositories/registered-agents.repository.js', () => ({
  getRegisteredAgent: mocks.getRegisteredAgent,
  isCapabilityGrouped: mocks.isCapabilityGrouped,
  recordInvocation: mocks.recordInvocation,
}));
vi.mock('@/lib/capability-runtime.js', () => ({
  prepareCapabilityInvocation: mocks.prepareCapabilityInvocation,
  executeCapabilityInvocation: mocks.executeCapabilityInvocation,
}));
vi.mock('@/lib/guard.js', () => ({ evaluateGuard: mocks.evaluateGuard }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  createActionRecord: mocks.createActionRecord,
  createBlockedActionRecord: mocks.createBlockedActionRecord,
  updateActionOutcome: mocks.updateActionOutcome,
}));
vi.mock('@/lib/predictive-risk.js', () => ({ getPredictiveRisk: mocks.getPredictiveRisk }));

const { deriveRegistryRisk, invokeRegisteredAgent } = await import('@/lib/agent-registry.js');
const { invokeCapability } = await import('@/lib/capability-invoke.js'); // real, for the SSRF check
const repo = await import('@/lib/repositories/registered-agents.repository.js'); // mocked above

const sql = createSqlMock();
const ACTIVE = { entry_id: 'reg_1', org_id: 'org_1', name: 'X', slug: 'x', risk_class: 'high', default_budget_usd: 0, status: 'active' };
const CAP = { name: 'Cap', slug: 'cap', risk_level: 'low', pricing: {}, requires_approval: false };
const PREP = { capability: CAP, schema: {}, authHeaders: {}, endpoint: 'https://provider.example.com' };

beforeEach(() => { vi.clearAllMocks(); });

describe('deriveRegistryRisk (C1)', () => {
  it('uses RISK_SCORE_MAP for risk_class, takes the max with the capability, and clamps', async () => {
    mocks.getPredictiveRisk.mockResolvedValue({ total_adjustment: 0 });
    const r = await deriveRegistryRisk(sql, 'org_1', { riskClass: 'high', capability: { risk_level: 'medium' }, agentId: 'a', budgetUsd: 0 });
    expect(r).toBe(75); // max(75, 50)
    const r2 = await deriveRegistryRisk(sql, 'org_1', { riskClass: 'low', capability: { risk_level: 'low' }, agentId: 'a', budgetUsd: 12 });
    expect(r2).toBe(30); // 20 + 10 budget bump
  });
});

describe('invokeRegisteredAgent (C3) — delegates to the capability runtime + guard + action', () => {
  it('404 for an unknown registered agent', async () => {
    mocks.getRegisteredAgent.mockResolvedValue(null);
    const out = await invokeRegisteredAgent(sql, 'org_1', { entryId: 'ghost', capabilityId: 'cap_1' });
    expect(out.status).toBe(404);
  });

  it('400 when the capability is not grouped under the agent', async () => {
    mocks.getRegisteredAgent.mockResolvedValue(ACTIVE);
    mocks.isCapabilityGrouped.mockResolvedValue(false);
    const out = await invokeRegisteredAgent(sql, 'org_1', { entryId: 'reg_1', capabilityId: 'cap_x' });
    expect(out.status).toBe(400);
    expect(mocks.prepareCapabilityInvocation).not.toHaveBeenCalled();
  });

  it('403 + blocked action when guard blocks', async () => {
    mocks.getRegisteredAgent.mockResolvedValue(ACTIVE);
    mocks.isCapabilityGrouped.mockResolvedValue(true);
    mocks.prepareCapabilityInvocation.mockResolvedValue(PREP);
    mocks.evaluateGuard.mockResolvedValue({ decision: 'block', reasons: ['policy'], matched_policies: ['gp_1'] });
    const out = await invokeRegisteredAgent(sql, 'org_1', { entryId: 'reg_1', capabilityId: 'cap_1', callerAgentId: 'a' });
    expect(out.status).toBe(403);
    expect(mocks.createBlockedActionRecord).toHaveBeenCalled();
    expect(mocks.executeCapabilityInvocation).not.toHaveBeenCalled();
    expect(mocks.recordInvocation).toHaveBeenCalled();
  });

  it('200 + recorded outcome on a governed success, delegating to executeCapabilityInvocation', async () => {
    mocks.getRegisteredAgent.mockResolvedValue(ACTIVE);
    mocks.isCapabilityGrouped.mockResolvedValue(true);
    mocks.prepareCapabilityInvocation.mockResolvedValue(PREP);
    mocks.evaluateGuard.mockResolvedValue({ decision: 'allow' });
    mocks.executeCapabilityInvocation.mockResolvedValue({ success: true, data: { ok: 1 }, elapsed_ms: 5 });
    const out = await invokeRegisteredAgent(sql, 'org_1', { entryId: 'reg_1', capabilityId: 'cap_1', callerAgentId: 'a' });
    expect(out.status).toBe(200);
    expect(mocks.executeCapabilityInvocation).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://provider.example.com' }));
    expect(mocks.updateActionOutcome).toHaveBeenCalledWith(sql, 'org_1', expect.any(String), expect.objectContaining({ status: 'completed' }));
  });
});

describe('agent registry — adversarial', () => {
  it('repository reads are org-scoped (no cross-org access)', async () => {
    const realRepo = await vi.importActual('../../app/lib/repositories/registered-agents.repository.js');
    const s = createSqlMock();
    await realRepo.getRegisteredAgent(s, 'org_77', 'reg_1');
    await realRepo.listRegisteredAgents(s, 'org_77', {});
    for (const call of s.taggedCalls) expect(call.values).toContain('org_77');
  });

  it('the capability runtime the registry delegates to rejects a loopback/non-https endpoint (inherited SSRF defense)', async () => {
    const result = await invokeCapability({ endpoint: 'http://127.0.0.1:9/secret', method: 'GET', authHeaders: {}, body: null });
    expect(result.success).toBe(false);
  });
});
