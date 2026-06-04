import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';
import { computeVector, buildReputationReceipt } from '../../app/lib/reputation.js';
import { generateSigningKey } from '../../app/lib/integrity/keys.js';

const { mockSql, mockAgentExists, repo, mockGetPublicJwks } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockAgentExists: vi.fn(),
  mockGetPublicJwks: vi.fn(),
  repo: {
    getReputationSnapshot: vi.fn(),
    computeReputationVector: vi.fn(),
    snapshotToVector: vi.fn((s) => (s ? { agent_id: s.agent_id, reliability_score: s.reliability_score } : null)),
    listReputationEvents: vi.fn(),
    recomputeReputation: vi.fn(),
    getLatestReputationReceipt: vi.fn(),
    buildCurrentReceipt: vi.fn(),
    listReputationSnapshots: vi.fn(),
  },
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/agents.repository.js', () => ({ agentExistsInOrg: mockAgentExists }));
vi.mock('@/lib/repositories/reputation.repository.js', () => repo);
vi.mock('@/lib/integrity/server-key.js', () => ({ getServerPublicJwks: mockGetPublicJwks }));

const { GET: getAgent } = await import('@/api/reputation/agents/[agentId]/route.js');
const { GET: getEvents } = await import('@/api/reputation/agents/[agentId]/events/route.js');
const { POST: postRecompute } = await import('@/api/reputation/agents/[agentId]/recompute/route.js');
const { GET: getReceipt } = await import('@/api/reputation/agents/[agentId]/receipt/route.js');
const { GET: getLeaderboard } = await import('@/api/reputation/leaderboard/route.js');
const { POST: postVerify } = await import('@/api/reputation/verify/route.js');

const req = (url = 'http://localhost/api/reputation/agents/agent_1') => makeRequest(url, { headers: { 'x-org-id': 'org_1' } });
const ctx = (agentId = 'agent_1') => ({ params: { agentId } });

beforeEach(() => { vi.clearAllMocks(); process.env.DATABASE_URL = 'postgres://unit-test'; });

describe('reputation routes (B3)', () => {
  it('GET agent returns the stored snapshot vector when present', async () => {
    repo.getReputationSnapshot.mockResolvedValue({ agent_id: 'agent_1', reliability_score: 0.8 });
    const res = await getAgent(req(), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe('snapshot');
    expect(data.vector.reliability_score).toBe(0.8);
  });

  it('GET agent computes read-only when no snapshot but the agent exists', async () => {
    repo.getReputationSnapshot.mockResolvedValue(null);
    mockAgentExists.mockResolvedValue(true);
    repo.computeReputationVector.mockResolvedValue({ agent_id: 'agent_1', reliability_score: 0.5 });
    const res = await getAgent(req(), ctx());
    const data = await res.json();
    expect(data.source).toBe('computed');
    expect(repo.computeReputationVector).toHaveBeenCalled();
  });

  it('GET agent returns 404 for an unknown agent', async () => {
    repo.getReputationSnapshot.mockResolvedValue(null);
    mockAgentExists.mockResolvedValue(false);
    const res = await getAgent(req(), ctx('ghost'));
    expect(res.status).toBe(404);
  });

  it('GET events returns 404 unknown, events for known', async () => {
    mockAgentExists.mockResolvedValueOnce(false);
    expect((await getEvents(req(), ctx('ghost'))).status).toBe(404);

    mockAgentExists.mockResolvedValueOnce(true);
    repo.listReputationEvents.mockResolvedValue([{ id: 'are_1', event_type: 'outcome' }]);
    const res = await getEvents(req('http://localhost/api/reputation/agents/agent_1/events?limit=10'), ctx());
    const data = await res.json();
    expect(data.events).toHaveLength(1);
    expect(data.pagination.limit).toBe(10);
  });

  it('POST recompute returns 404 unknown, vector for known', async () => {
    mockAgentExists.mockResolvedValueOnce(false);
    expect((await postRecompute(req(), ctx('ghost'))).status).toBe(404);

    mockAgentExists.mockResolvedValueOnce(true);
    repo.recomputeReputation.mockResolvedValue({ vector: { agent_id: 'agent_1', computed_at: '2026-06-04T00:00:00Z', reliability_score: 0.6 } });
    const res = await postRecompute(req(), ctx());
    const data = await res.json();
    expect(data.vector.reliability_score).toBe(0.6);
    expect(repo.recomputeReputation).toHaveBeenCalled();
  });

  it('GET receipt returns the stored receipt when present', async () => {
    repo.getLatestReputationReceipt.mockResolvedValue({ vectorHash: 'sha256:abc', signature: {} });
    const res = await getReceipt(req(), ctx());
    const data = await res.json();
    expect(data.source).toBe('stored');
  });

  it('GET leaderboard maps snapshots, org-scoped', async () => {
    repo.listReputationSnapshots.mockResolvedValue([{ agent_id: 'a', reliability_score: 0.9 }]);
    const res = await getLeaderboard(makeRequest('http://localhost/api/reputation/leaderboard', { headers: { 'x-org-id': 'org_1' } }));
    const data = await res.json();
    expect(data.leaderboard).toHaveLength(1);
    expect(repo.listReputationSnapshots).toHaveBeenCalledWith(mockSql, 'org_1', { limit: 20 });
  });
});

describe('POST /api/reputation/verify (B3) — real crypto', () => {
  it('verifies a genuine receipt and rejects a tampered one and a missing one', async () => {
    const key = generateSigningKey();
    mockGetPublicJwks.mockResolvedValue({ keys: [key.publicKeyJwk] });

    const vector = computeVector('agent_1', [{ event_type: 'outcome', value: 1, occurred_at: '2026-06-01T00:00:00Z' }], { now: '2026-06-04T00:00:00Z' });
    const receipt = buildReputationReceipt(vector, { kid: key.kid, privateKeyJwk: key.privateKeyJwk }, vector.computed_at);

    const okRes = await postVerify(makeRequest('http://localhost/api/reputation/verify', { headers: {}, body: { receipt } }));
    expect(await okRes.json()).toMatchObject({ ok: true });

    const tampered = { ...receipt, vector: { ...receipt.vector, reliability_score: 0.99 } };
    const badRes = await postVerify(makeRequest('http://localhost/api/reputation/verify', { headers: {}, body: { receipt: tampered } }));
    expect(await badRes.json()).toMatchObject({ ok: false, reason: 'vector_hash_mismatch' });

    const missingRes = await postVerify(makeRequest('http://localhost/api/reputation/verify', { headers: {}, body: {} }));
    expect(await missingRes.json()).toMatchObject({ ok: false, reason: 'missing_receipt' });
  });
});
