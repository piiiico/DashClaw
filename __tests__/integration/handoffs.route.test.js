import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({
  createHandoff: vi.fn(),
  getLatestHandoff: vi.fn(),
  getHandoffById: vi.fn(),
  consumeHandoff: vi.fn(),
}));
vi.mock('../../app/lib/repositories/code-session-handoffs.repository.js', () => repo);
vi.mock('../../app/lib/db.js', () => ({ getSql: () => ({}) }));
vi.mock('../../app/lib/org.js', () => ({ getOrgId: async () => 'org_1' }));

beforeEach(() => {
  Object.values(repo).forEach((fn) => fn.mockReset());
});

function jsonRequest(url, method, body) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-api-key': 'test' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/handoffs', () => {
  it('creates handoff with valid body', async () => {
    repo.createHandoff.mockResolvedValue({ id: 'hf_1' });
    const { POST } = await import('../../app/api/handoffs/route.js');
    const res = await POST(jsonRequest('http://test/api/handoffs', 'POST', { agent_id: 'hermes', bundle: { summary: 's' } }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe('hf_1');
  });

  it('returns 400 if agent_id missing', async () => {
    const { POST } = await import('../../app/api/handoffs/route.js');
    const res = await POST(jsonRequest('http://test/api/handoffs', 'POST', { bundle: {} }));
    expect(res.status).toBe(400);
  });

  it('returns 400 if bundle missing', async () => {
    const { POST } = await import('../../app/api/handoffs/route.js');
    const res = await POST(jsonRequest('http://test/api/handoffs', 'POST', { agent_id: 'h' }));
    expect(res.status).toBe(400);
  });

  it('returns 500 on repository error', async () => {
    repo.createHandoff.mockRejectedValue(new Error('db down'));
    const { POST } = await import('../../app/api/handoffs/route.js');
    const res = await POST(jsonRequest('http://test/api/handoffs', 'POST', { agent_id: 'h', bundle: {} }));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/handoffs/latest', () => {
  it('returns 200 + bundle when found', async () => {
    repo.getLatestHandoff.mockResolvedValue({ id: 'hf_1', bundle_json: { summary: 's' } });
    const { GET } = await import('../../app/api/handoffs/latest/route.js');
    const res = await GET(new Request('http://test/api/handoffs/latest?agent_id=hermes&project_id=cp_1', {
      headers: { 'x-api-key': 'test' },
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bundle.summary).toBe('s');
  });

  it('returns 404 when no handoff', async () => {
    repo.getLatestHandoff.mockResolvedValue(null);
    const { GET } = await import('../../app/api/handoffs/latest/route.js');
    const res = await GET(new Request('http://test/api/handoffs/latest?agent_id=hermes', {
      headers: { 'x-api-key': 'test' },
    }));
    expect(res.status).toBe(404);
  });

  it('returns 400 if agent_id missing', async () => {
    const { GET } = await import('../../app/api/handoffs/latest/route.js');
    const res = await GET(new Request('http://test/api/handoffs/latest', {
      headers: { 'x-api-key': 'test' },
    }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/handoffs/[id]', () => {
  it('returns row by id', async () => {
    repo.getHandoffById.mockResolvedValue({ id: 'hf_1', bundle_json: { summary: 's' } });
    const { GET } = await import('../../app/api/handoffs/[id]/route.js');
    const res = await GET(new Request('http://test/api/handoffs/hf_1', { headers: { 'x-api-key': 'test' } }), {
      params: Promise.resolve({ id: 'hf_1' }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 when missing', async () => {
    repo.getHandoffById.mockResolvedValue(null);
    const { GET } = await import('../../app/api/handoffs/[id]/route.js');
    const res = await GET(new Request('http://test/api/handoffs/hf_missing', { headers: { 'x-api-key': 'test' } }), {
      params: Promise.resolve({ id: 'hf_missing' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/handoffs/[id]/consume', () => {
  it('marks consumed and returns ok', async () => {
    repo.consumeHandoff.mockResolvedValue({ id: 'hf_1', consumed_at: '2026-05-14T00:00:00Z' });
    const { POST } = await import('../../app/api/handoffs/[id]/consume/route.js');
    const res = await POST(jsonRequest('http://test/api/handoffs/hf_1/consume', 'POST', { session_id: 'cs_100' }),
      { params: Promise.resolve({ id: 'hf_1' }) });
    expect(res.status).toBe(200);
  });

  it('returns 404 when handoff does not exist', async () => {
    repo.consumeHandoff.mockResolvedValue(null);
    const { POST } = await import('../../app/api/handoffs/[id]/consume/route.js');
    const res = await POST(jsonRequest('http://test/api/handoffs/hf_missing/consume', 'POST', {}),
      { params: Promise.resolve({ id: 'hf_missing' }) });
    expect(res.status).toBe(404);
  });
});
