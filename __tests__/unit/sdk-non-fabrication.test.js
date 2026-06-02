import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { DashClaw } = await import('../../sdk/dashclaw.js');

describe('DashClaw non-fabrication fields', () => {
  let claw;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ decision: 'allow' }) });
    claw = new DashClaw({ baseUrl: 'http://localhost:3000', apiKey: 'k', agentId: 'a1' });
  });

  it('guard() forwards content + sourceOfTruth to /api/guard', async () => {
    await claw.guard({
      action_type: 'message',
      content: 'Dear Jane, your balance is $10.00.',
      sourceOfTruth: { allowedFacts: [{ label: 'bal', value: '$10.00' }], requiredFacts: [] },
    });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/guard');
    const body = JSON.parse(opts.body);
    expect(body.content).toBe('Dear Jane, your balance is $10.00.');
    expect(body.sourceOfTruth).toEqual({ allowedFacts: [{ label: 'bal', value: '$10.00' }], requiredFacts: [] });
  });

  it('createAction() forwards content + sourceOfTruth to /api/actions', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ action_id: 'x' }) });
    await claw.createAction({
      action_type: 'message',
      declared_goal: 'send',
      content: 'hi',
      sourceOfTruth: { allowedFacts: [], requiredFacts: [] },
    });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/actions');
    const body = JSON.parse(opts.body);
    expect(body.content).toBe('hi');
    expect(body.sourceOfTruth).toEqual({ allowedFacts: [], requiredFacts: [] });
  });
});
