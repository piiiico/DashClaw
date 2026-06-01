import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

// GET /api/learning reads the `decisions` and `lessons` tables via tagged
// templates. The mock routes by statement text so we can drive each table's
// rows and simulate a missing table. This route previously had no unit
// coverage; dashclaw_learning_query (MCP) now depends on it.
const { mockSql, state } = vi.hoisted(() => {
  const state = { decisions: [], lessons: [], throwMissing: null, lastDecisionValues: null };
  const sql = (strings, ...values) => {
    const text = strings.join(' ? ');
    if (/FROM\s+decisions/i.test(text)) {
      state.lastDecisionValues = values;
      if (state.throwMissing === 'decisions') {
        const e = new Error('relation "decisions" does not exist');
        e.code = '42P01';
        return Promise.reject(e);
      }
      return Promise.resolve(state.decisions);
    }
    if (/FROM\s+lessons/i.test(text)) {
      return Promise.resolve(state.lessons);
    }
    return Promise.resolve([]);
  };
  return { mockSql: sql, state };
});

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));

import { GET } from '@/api/learning/route.js';

describe('/api/learning GET', () => {
  beforeEach(() => {
    state.decisions = [
      { decision: 'use neon', context: 'db', outcome: 'success' },
      { decision: 'add cache', context: 'perf', outcome: 'pending' },
    ];
    state.lessons = [{ id: 'lesson_1', confidence: 90 }];
    state.throwMissing = null;
    state.lastDecisionValues = null;
    process.env.DATABASE_URL = 'postgres://unit-test';
  });

  it('returns decisions, lessons, and computed stats', async () => {
    const res = await GET(makeRequest('http://localhost/api/learning'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.decisions).toHaveLength(2);
    expect(data.lessons).toHaveLength(1);
    expect(data.stats.totalDecisions).toBe(2);
    expect(data.stats.totalLessons).toBe(1);
    // 1 success of 1 with a terminal outcome (pending excluded)
    expect(data.stats.successRate).toBe(100);
    expect(data.stats.patterns).toBe(1);
  });

  it('scopes decisions by agent_id when supplied', async () => {
    await GET(makeRequest('http://localhost/api/learning?agent_id=bot1'));
    expect(state.lastDecisionValues).toContain('bot1');
  });

  it('degrades to empty decisions when the table is missing (no 500)', async () => {
    state.throwMissing = 'decisions';
    const res = await GET(makeRequest('http://localhost/api/learning'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.decisions).toEqual([]);
    expect(data.lessons).toHaveLength(1);
  });
});
