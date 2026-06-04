import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { DashClaw } = await import('../../sdk/dashclaw.js');

describe('createAction session_id passthrough', () => {
  let claw;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ action_id: 'act_1' }) });
    claw = new DashClaw({ baseUrl: 'http://localhost:3000', apiKey: 'k', agentId: 'a1' });
  });

  it('forwards session_id to POST /api/actions', async () => {
    await claw.createAction({ action_type: 'research', declared_goal: 'g', session_id: 'sess_7' });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/actions');
    expect(JSON.parse(opts.body).session_id).toBe('sess_7');
  });

  it('omits session_id when not provided', async () => {
    await claw.createAction({ action_type: 'research', declared_goal: 'g' });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body).session_id).toBeUndefined();
  });
});
