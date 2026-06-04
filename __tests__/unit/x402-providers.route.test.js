import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSql, mockCreateProvider, mockListProviders } = vi.hoisted(() => ({
  mockSql: vi.fn(async () => []),
  mockCreateProvider: vi.fn(),
  mockListProviders: vi.fn(),
}));
vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1' }));
vi.mock('@/lib/repositories/x402.repository.js', () => ({
  createProvider: mockCreateProvider,
  listProviders: mockListProviders,
}));

const { GET, POST } = await import('@/api/x402/providers/route.js');
function req(method, body) {
  return new Request('http://localhost/api/x402/providers', {
    method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => vi.clearAllMocks());

describe('/api/x402/providers', () => {
  it('GET lists providers', async () => {
    mockListProviders.mockResolvedValue([{ provider_id: 'prov_x' }]);
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    expect((await res.json()).providers).toHaveLength(1);
  });

  it('GET passes the status filter through to the repository', async () => {
    mockListProviders.mockResolvedValue([]);
    await GET(new Request('http://localhost/api/x402/providers?status=active'));
    expect(mockListProviders).toHaveBeenCalledWith(mockSql, 'org_1', { status: 'active' });
  });

  it('POST 400 when name missing', async () => {
    const res = await POST(req('POST', {}));
    expect(res.status).toBe(400);
    expect(mockCreateProvider).not.toHaveBeenCalled();
  });

  it('POST 201 creates a provider', async () => {
    mockCreateProvider.mockResolvedValue({ provider_id: 'prov_x', name: 'Exa' });
    const res = await POST(req('POST', { name: 'Exa' }));
    expect(res.status).toBe(201);
    expect((await res.json()).provider.provider_id).toBe('prov_x');
    expect(mockCreateProvider).toHaveBeenCalledWith(mockSql, 'org_1', { name: 'Exa' });
  });
});
