import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

// A6: the map route must surface each control's expected policy_mappings (from
// the framework definition) so the UI can offer a deterministic
// "create policy from this gap" prefill. mapPolicies itself is unchanged.
const { mockSql, mockGetActivePolicies, mockConvertPolicies, mockMapPolicies, mockLoadFramework, mockListFrameworks } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetActivePolicies: vi.fn(),
  mockConvertPolicies: vi.fn(),
  mockMapPolicies: vi.fn(),
  mockLoadFramework: vi.fn(),
  mockListFrameworks: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({ getActivePolicies: mockGetActivePolicies }));
vi.mock('@/lib/guardrails/converter.js', () => ({ convertPolicies: mockConvertPolicies }));
vi.mock('@/lib/compliance/mapper.js', () => ({ mapPolicies: mockMapPolicies, loadFramework: mockLoadFramework, listFrameworks: mockListFrameworks }));

import { GET } from '@/api/compliance/map/route.js';

describe('/api/compliance/map GET — policy_mappings enrichment (A6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
  });

  it('merges framework control policy_mappings onto the mapped controls by control_id', async () => {
    mockLoadFramework.mockReturnValue({
      framework: 'SOC 2',
      controls: [{ id: 'CC6.1', title: 'Logical Access', policy_mappings: [{ policy_pattern: 'block', tool_patterns: ['exec'] }] }],
    });
    mockGetActivePolicies.mockResolvedValue([]);
    mockConvertPolicies.mockReturnValue({ version: 1, project: 'org-org_1', policies: [] });
    mockMapPolicies.mockReturnValue({
      framework: 'SOC 2',
      summary: { total_controls: 1, covered: 0, partial: 0, gaps: 1, coverage_percentage: 0 },
      controls: [{ control_id: 'CC6.1', title: 'Logical Access', status: 'gap', matched_policies: [], gap_recommendations: [] }],
    });

    const res = await GET(makeRequest('http://localhost/api/compliance/map?framework=soc2', { headers: { 'x-org-id': 'org_1' } }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.controls[0].policy_mappings).toEqual([{ policy_pattern: 'block', tool_patterns: ['exec'] }]);
    // mapping result fields are preserved.
    expect(data.controls[0].status).toBe('gap');
  });
});
