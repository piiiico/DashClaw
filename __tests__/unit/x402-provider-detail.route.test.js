import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSql, mockGetProvider, mockUpdateProvider, mockListEndpoints } = vi.hoisted(() => ({
  mockSql: vi.fn(async () => []),
  mockGetProvider: vi.fn(),
  mockUpdateProvider: vi.fn(),
  mockListEndpoints: vi.fn(),
}));
vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1' }));
vi.mock('@/lib/repositories/x402.repository.js', () => ({
  getProvider: mockGetProvider,
  updateProvider: mockUpdateProvider,
  listEndpoints: mockListEndpoints,
}));

const { GET, PATCH } = await import('@/api/x402/providers/[id]/route.js');
const ctx = (id) => ({ params: Promise.resolve({ id }) });
function req(method, body) {
  return new Request('http://localhost/api/x402/providers/prov_x', {
    method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => vi.clearAllMocks());

describe('/api/x402/providers/[id]', () => {
  it('GET 404 when missing', async () => {
    mockGetProvider.mockResolvedValue(null);
    const res = await GET(req('GET'), ctx('prov_missing'));
    expect(res.status).toBe(404);
  });

  it('GET 200 returns provider + endpoints', async () => {
    mockGetProvider.mockResolvedValue({ provider_id: 'prov_x' });
    mockListEndpoints.mockResolvedValue([{ endpoint_id: 'pep_1' }]);
    const res = await GET(req('GET'), ctx('prov_x'));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.provider.provider_id).toBe('prov_x');
    expect(j.endpoints).toHaveLength(1);
    expect(mockGetProvider).toHaveBeenCalledWith(mockSql, 'org_1', 'prov_x');
  });

  it('PATCH 404 when provider missing', async () => {
    mockUpdateProvider.mockResolvedValue(null);
    const res = await PATCH(req('PATCH', { status: 'disabled' }), ctx('prov_missing'));
    expect(res.status).toBe(404);
  });

  it('PATCH 200 updates and forwards the patch', async () => {
    mockUpdateProvider.mockResolvedValue({ provider_id: 'prov_x', status: 'disabled' });
    const res = await PATCH(req('PATCH', { status: 'disabled' }), ctx('prov_x'));
    expect(res.status).toBe(200);
    expect((await res.json()).provider.status).toBe('disabled');
    expect(mockUpdateProvider).toHaveBeenCalledWith(mockSql, 'org_1', 'prov_x', { status: 'disabled' });
  });
});
