import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({
  createHandoff: vi.fn(),
  getLatestHandoff: vi.fn(),
  consumeHandoff: vi.fn(),
  getHandoffById: vi.fn(),
}));
vi.mock('../../app/lib/repositories/code-session-handoffs.repository.js', () => repo);
vi.mock('../../app/lib/db.js', () => ({ getSql: () => ({}) }));
vi.mock('../../app/lib/org.js', () => ({ getOrgId: () => 'org_e2e' }));

beforeEach(() => Object.values(repo).forEach((fn) => fn.mockReset()));

describe('handoff end-to-end loop', () => {
  it('create -> latest (200) -> consume -> latest (404)', async () => {
    // 1. Create
    repo.createHandoff.mockResolvedValue({ id: 'hf_e2e' });
    const { POST: createRoute } = await import('../../app/api/handoffs/route.js');
    const createRes = await createRoute(new Request('http://test/api/handoffs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test' },
      body: JSON.stringify({
        agent_id: 'test-hermes',
        bundle: { summary: 'session N done', open_loops: [] },
      }),
    }));
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json();
    expect(id).toBe('hf_e2e');

    // 2. Latest — returns the new handoff
    repo.getLatestHandoff.mockResolvedValueOnce({
      id: 'hf_e2e',
      bundle_json: { summary: 'session N done', open_loops: [] },
      agent_id: 'test-hermes',
    });
    const { GET: latestRoute } = await import('../../app/api/handoffs/latest/route.js');
    const latestRes = await latestRoute(new Request('http://test/api/handoffs/latest?agent_id=test-hermes', {
      headers: { 'x-api-key': 'test' },
    }));
    expect(latestRes.status).toBe(200);
    const latestBody = await latestRes.json();
    expect(latestBody.id).toBe('hf_e2e');
    expect(latestBody.bundle.summary).toBe('session N done');

    // 3. Consume
    repo.consumeHandoff.mockResolvedValue({ id: 'hf_e2e', consumed_at: '2026-05-14T00:00:00Z' });
    const { POST: consumeRoute } = await import('../../app/api/handoffs/[id]/consume/route.js');
    const consumeRes = await consumeRoute(new Request('http://test/api/handoffs/hf_e2e/consume', {
      method: 'POST',
      headers: { 'x-api-key': 'test', 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 'cs_e2e' }),
    }), { params: Promise.resolve({ id: 'hf_e2e' }) });
    expect(consumeRes.status).toBe(200);

    // 4. Latest after consume — 404
    repo.getLatestHandoff.mockResolvedValueOnce(null);
    const latestAfter = await latestRoute(new Request('http://test/api/handoffs/latest?agent_id=test-hermes', {
      headers: { 'x-api-key': 'test' },
    }));
    expect(latestAfter.status).toBe(404);
  });
});
