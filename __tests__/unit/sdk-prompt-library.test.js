import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally so SDK methods can be asserted on URL/method/body without a server.
const mockFetch = vi.fn();
global.fetch = mockFetch;

const { DashClaw } = await import('../../sdk/dashclaw.js');

function lastCall() {
  const [url, opts] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return { url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers };
}

describe('DashClaw — Prompt Library / Learning / Policies / Evaluations wrappers', () => {
  let claw;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    claw = new DashClaw({ baseUrl: 'http://localhost:3000', apiKey: 'k', agentId: 'agent-1' });
  });

  // --- Prompt Library ---

  it('listPromptTemplates passes category as a query param (GET, no body)', async () => {
    await claw.listPromptTemplates({ category: 'branch-finish' });
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/prompts/templates?category=branch-finish');
    expect(c.body).toBeUndefined();
    expect(c.headers['x-api-key']).toBe('k');
  });

  it('createPromptTemplate POSTs the template body', async () => {
    await claw.createPromptTemplate({ name: 'Branch Finish', category: 'branch-finish' });
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/prompts/templates');
    expect(c.body).toEqual({ name: 'Branch Finish', category: 'branch-finish' });
  });

  it('createPromptVersion POSTs content to the versions sub-resource', async () => {
    await claw.createPromptVersion('pt_1', { content: 'Hello {{name}}', changelog: 'v1' });
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/prompts/templates/pt_1/versions');
    expect(c.body).toEqual({ content: 'Hello {{name}}', changelog: 'v1' });
  });

  it('activatePromptVersion POSTs to the version URL with no body', async () => {
    await claw.activatePromptVersion('pt_1', 'pv_9');
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/prompts/templates/pt_1/versions/pv_9');
    expect(c.body).toBeUndefined();
  });

  it('getPromptStats forwards template_id as a query param', async () => {
    await claw.getPromptStats({ template_id: 'pt_1' });
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/prompts/stats?template_id=pt_1');
  });

  it('deletePromptTemplate issues a DELETE to the template URL', async () => {
    await claw.deletePromptTemplate('pt_1');
    const c = lastCall();
    expect(c.method).toBe('DELETE');
    expect(c.url).toBe('http://localhost:3000/api/prompts/templates/pt_1');
  });

  // --- Knowledge delete (newly added) ---

  it('deleteKnowledgeCollection issues a DELETE to the collection URL', async () => {
    await claw.deleteKnowledgeCollection('kc_1');
    const c = lastCall();
    expect(c.method).toBe('DELETE');
    expect(c.url).toBe('http://localhost:3000/api/knowledge/collections/kc_1');
  });

  // --- Learning ---

  it('recordDecision POSTs to /api/learning and injects agent_id', async () => {
    await claw.recordDecision({ decision: 'finish branch', outcome: 'success' });
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/learning');
    expect(c.body.decision).toBe('finish branch');
    expect(c.body.outcome).toBe('success');
    expect(c.body.agent_id).toBe('agent-1');
  });

  it('recordDecision keeps an explicit agent_id', async () => {
    await claw.recordDecision({ decision: 'x', agent_id: 'other' });
    expect(lastCall().body.agent_id).toBe('other');
  });

  it('getLearningRecommendations GETs with agent_id injected into the query', async () => {
    await claw.getLearningRecommendations({ action_type: 'branch_finish' });
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toContain('/api/learning/recommendations?');
    expect(c.url).toContain('action_type=branch_finish');
    expect(c.url).toContain('agent_id=agent-1');
  });

  // --- Policies ---

  it('simulatePolicy POSTs policy_type + rules, omitting days when not given', async () => {
    await claw.simulatePolicy({ policy_type: 'block_action_type', rules: { action_types: ['deploy'] } });
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/policies/simulate');
    expect(c.body).toEqual({ policy_type: 'block_action_type', rules: { action_types: ['deploy'] } });
    expect('days' in c.body).toBe(false);
  });

  it('simulatePolicy includes days when provided', async () => {
    await claw.simulatePolicy({ policy_type: 'risk_threshold', rules: { threshold: 70 }, days: 14 });
    expect(lastCall().body.days).toBe(14);
  });

  // --- Evaluations preview ---

  it('previewScorer POSTs the scorer config + sample', async () => {
    await claw.previewScorer({
      scorer_type: 'contains',
      config: { keywords: ['tests pass'] },
      sample: { outcome: 'tests pass' },
    });
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/evaluations/scorers/preview');
    expect(c.body.scorer_type).toBe('contains');
    expect(c.body.config).toEqual({ keywords: ['tests pass'] });
    expect(c.body.sample).toEqual({ outcome: 'tests pass' });
  });
});
