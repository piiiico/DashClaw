import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSql, mockCreateEndpoint, mockListEndpoints, mockGetProvider } = vi.hoisted(() => ({
  mockSql: vi.fn(async () => []),
  mockCreateEndpoint: vi.fn(),
  mockListEndpoints: vi.fn(),
  mockGetProvider: vi.fn(),
}));
vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1' }));
vi.mock('@/lib/repositories/x402.repository.js', () => ({
  createEndpoint: mockCreateEndpoint,
  listEndpoints: mockListEndpoints,
  getProvider: mockGetProvider,
}));

const { GET, POST } = await import('@/api/x402/providers/[id]/endpoints/route.js');
const ctx = (id) => ({ params: Promise.resolve({ id }) });
function req(method, body) {
  return new Request('http://localhost/api/x402/providers/prov_x/endpoints', {
    method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the parent provider exists in this org.
  mockGetProvider.mockResolvedValue({ provider_id: 'prov_x', org_id: 'org_1', name: 'Exa', status: 'active' });
});

describe('/api/x402/providers/[id]/endpoints', () => {
  it('GET lists endpoints for the provider', async () => {
    mockListEndpoints.mockResolvedValue([{ endpoint_id: 'pep_1' }]);
    const res = await GET(req('GET'), ctx('prov_x'));
    expect(res.status).toBe(200);
    expect((await res.json()).endpoints).toHaveLength(1);
    expect(mockListEndpoints).toHaveBeenCalledWith(mockSql, 'org_1', 'prov_x');
  });

  it('POST 400 when name missing', async () => {
    const res = await POST(req('POST', {}), ctx('prov_x'));
    expect(res.status).toBe(400);
    expect(mockCreateEndpoint).not.toHaveBeenCalled();
  });

  it('POST 201 creates an endpoint under the provider', async () => {
    mockCreateEndpoint.mockResolvedValue({ endpoint_id: 'pep_1', name: 'Search' });
    const res = await POST(req('POST', { name: 'Search' }), ctx('prov_x'));
    expect(res.status).toBe(201);
    expect((await res.json()).endpoint.endpoint_id).toBe('pep_1');
    expect(mockCreateEndpoint).toHaveBeenCalledWith(mockSql, 'org_1', 'prov_x', { name: 'Search' });
  });

  it('POST 404 when the parent provider does not exist in this org (X2)', async () => {
    mockGetProvider.mockResolvedValue(null);
    const res = await POST(req('POST', { name: 'Search' }), ctx('prov_missing'));
    expect(res.status).toBe(404);
    expect(mockCreateEndpoint).not.toHaveBeenCalled();
  });
});
