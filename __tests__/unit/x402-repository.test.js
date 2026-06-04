import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProvider, listProviders, getProvider, updateProvider,
  createEndpoint, listEndpoints, getEndpoint,
} from '@/lib/repositories/x402.repository.js';

// __tests__/helpers.js `createSqlMock` uses a pre-seeded taggedResponses/queryCalls
// shape (NOT vi.fn) and exposes `.taggedCalls`, not `.mock.calls`. For repository
// SQL tests we use a plain vi.fn() as the tagged-template `sql`. When called as a
// tagged template, the mock receives (templateStringsArray, ...interpolatedValues),
// so calls[n][0] is the SQL skeleton and calls[n].slice(1) are the bound values.
let sql;
beforeEach(() => { sql = vi.fn(); });
const sqlText = (call) => call[0].join('?');
const sqlValues = (call) => call.slice(1);

describe('x402 provider repository', () => {
  it('createProvider mints a prov_ id, slugifies the name, and binds the org as a value', async () => {
    sql.mockResolvedValueOnce([{ provider_id: 'prov_x', org_id: 'org_1', name: 'Exa', slug: 'exa-search' }]);
    const row = await createProvider(sql, 'org_1', { name: 'Exa Search' });
    expect(row.provider_id).toBe('prov_x');
    const call = sql.mock.calls[0];
    expect(sqlText(call)).toContain('INSERT INTO x402_providers');
    expect(call[1]).toMatch(/^prov_/);   // generated provider_id (not just the mocked return)
    expect(call[2]).toBe('org_1');       // org scoping bound as a parameter
    expect(call[4]).toBe('exa-search');  // slug derived from the name by slugify
  });

  it('listProviders filters by org + status', async () => {
    sql.mockResolvedValueOnce([{ provider_id: 'prov_x' }]);
    const rows = await listProviders(sql, 'org_1', { status: 'active' });
    expect(rows).toHaveLength(1);
    const call = sql.mock.calls[0];
    expect(sqlText(call)).toContain('AND status =');
    expect(sqlValues(call)).toEqual(['org_1', 'active']);
  });

  it('listProviders without a status uses the unfiltered org-scoped query', async () => {
    sql.mockResolvedValueOnce([{ provider_id: 'prov_a' }, { provider_id: 'prov_b' }]);
    const rows = await listProviders(sql, 'org_1');
    expect(rows).toHaveLength(2);
    const call = sql.mock.calls[0];
    expect(sqlText(call)).toContain('FROM x402_providers');
    expect(sqlText(call)).not.toContain('AND status =');
    expect(sqlValues(call)).toEqual(['org_1']);
  });

  it('getProvider binds org + id and returns null when missing', async () => {
    sql.mockResolvedValueOnce([]);
    expect(await getProvider(sql, 'org_1', 'prov_missing')).toBeNull();
    expect(sqlValues(sql.mock.calls[0])).toEqual(['org_1', 'prov_missing']);
  });

  it('updateProvider applies whitelisted fields and ignores non-whitelisted ones', async () => {
    sql.mockResolvedValueOnce([{ provider_id: 'prov_x', name: 'Exa', status: 'active', category: 'research', base_url: null, description: null, pricing_model: null, default_currency: 'USDC', metadata: '{}' }]);
    sql.mockResolvedValueOnce([{ provider_id: 'prov_x', status: 'disabled' }]);
    const row = await updateProvider(sql, 'org_1', 'prov_x', { status: 'disabled', slug: 'evil', provider_id: 'evil', org_id: 'evil' });
    expect(row.status).toBe('disabled');
    const updateValues = sqlValues(sql.mock.calls[1]);
    expect(updateValues).toContain('disabled');  // whitelisted patch applied
    expect(updateValues).not.toContain('evil');   // slug / provider_id / org_id are NOT patchable
    expect(updateValues).toContain('org_1');       // org scoping preserved
    expect(updateValues).toContain('prov_x');      // target id preserved
  });

  it('updateProvider returns null without issuing an UPDATE when the provider is missing', async () => {
    sql.mockResolvedValueOnce([]); // getProvider miss
    expect(await updateProvider(sql, 'org_1', 'prov_missing', { status: 'disabled' })).toBeNull();
    expect(sql.mock.calls).toHaveLength(1); // no second (UPDATE) query was issued
  });
});

describe('x402 endpoint repository', () => {
  it('createEndpoint mints a pep_ id under a provider and binds org + provider + slug', async () => {
    sql.mockResolvedValueOnce([{ endpoint_id: 'pep_1', provider_id: 'prov_x', slug: 'search' }]);
    const row = await createEndpoint(sql, 'org_1', 'prov_x', { name: 'Search' });
    expect(row.endpoint_id).toBe('pep_1');
    const call = sql.mock.calls[0];
    expect(sqlText(call)).toContain('INSERT INTO x402_endpoints');
    expect(call[1]).toMatch(/^pep_/);  // generated endpoint_id
    expect(call[2]).toBe('org_1');      // org bound as a value
    expect(call[3]).toBe('prov_x');     // provider bound as a value
    expect(call[5]).toBe('search');     // slug derived from name
  });

  it('listEndpoints scopes by org + provider', async () => {
    sql.mockResolvedValueOnce([{ endpoint_id: 'pep_1' }]);
    const rows = await listEndpoints(sql, 'org_1', 'prov_x');
    expect(rows).toHaveLength(1);
    expect(sqlValues(sql.mock.calls[0])).toEqual(['org_1', 'prov_x']);
  });

  it('getEndpoint binds org + id and returns null when missing', async () => {
    sql.mockResolvedValueOnce([]);
    expect(await getEndpoint(sql, 'org_1', 'pep_missing')).toBeNull();
    expect(sqlValues(sql.mock.calls[0])).toEqual(['org_1', 'pep_missing']);
  });
});
