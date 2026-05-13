import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockTimingSafeCompare, mockDetectCacheCrater, mockInsertAlerts } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockTimingSafeCompare: vi.fn(),
  mockDetectCacheCrater: vi.fn(),
  mockInsertAlerts: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/timing-safe.js', () => ({ timingSafeCompare: mockTimingSafeCompare }));
vi.mock('@/lib/claude-code/alerts.js', () => ({ detectCacheCrater: mockDetectCacheCrater }));
vi.mock('@/lib/repositories/code-sessions.repository.js', () => ({ insertAlerts: mockInsertAlerts }));

const { GET } = await import('@/api/cron/code-session-cache-crater/route.js');

beforeEach(() => {
  mockSql.mockReset();
  mockTimingSafeCompare.mockReset();
  mockDetectCacheCrater.mockReset();
  mockInsertAlerts.mockReset();
  mockInsertAlerts.mockResolvedValue(1);
  process.env.CRON_SECRET = 'secret-test-value';
});

describe('GET /api/cron/code-session-cache-crater', () => {
  it('returns 503 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest('http://test/api/cron/code-session-cache-crater'));
    expect(res.status).toBe(503);
  });

  it('returns 401 on bad auth header', async () => {
    mockTimingSafeCompare.mockReturnValue(false);
    const res = await GET(makeRequest('http://test/api/cron/code-session-cache-crater', {
      headers: { authorization: 'Bearer wrong' },
    }));
    expect(res.status).toBe(401);
  });

  it('iterates projects and inserts alerts when detectCacheCrater fires', async () => {
    mockTimingSafeCompare.mockReturnValue(true);
    // Sequence: list projects -> thisWeek totals -> priorWeek totals
    mockSql.mockImplementation(async () => {
      // Use call count to differentiate.
      const callIndex = mockSql.mock.calls.length;
      if (callIndex === 1) return [{ project_id: 'cp_1', org_id: 'org_a', slug: 'demo' }];
      if (callIndex === 2) return [{ input_tokens: 100, cache_read_tokens: 100, cache_creation_tokens: 100 }];
      if (callIndex === 3) return [{ input_tokens: 100, cache_read_tokens: 9000, cache_creation_tokens: 100 }];
      return [];
    });
    mockDetectCacheCrater.mockReturnValue({
      kind: 'cache_crater', severity: 'warn',
      title: 'Cache hit rate dropped', body: 'details',
    });

    const res = await GET(makeRequest('http://test/api/cron/code-session-cache-crater', {
      headers: { authorization: 'Bearer secret-test-value' },
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.projects_scanned).toBe(1);
    expect(json.alerts_inserted).toBe(1);
    expect(mockDetectCacheCrater).toHaveBeenCalledTimes(1);
    expect(mockInsertAlerts).toHaveBeenCalledTimes(1);
  });
});
