import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSqlMock } from '../../helpers.js';

// Bypass settings.repository.getModelPricing — it queries SQL we don't want
// to mock per call.
vi.mock('@/lib/repositories/settings.repository.js', () => ({
  getModelPricing: vi.fn(async () => null),
}));

const { upsertSessionWithChildren, upsertProject } = await import('@/lib/repositories/code-sessions.repository.js');

function fixtureParsed(overrides = {}) {
  return {
    sessionUuid: 'sess-xyz',
    projectSlug: null,
    cwd: 'C:/p',
    startedAt: '2026-05-13T12:00:00Z',
    endedAt: '2026-05-13T12:01:00Z',
    modelPrimary: 'claude-sonnet-4-6',
    sourceMtime: '2026-05-13T12:01:30Z',
    sourceFile: '/tmp/x.jsonl',
    parserVersion: 2,
    jsonlRecords: 3,
    modelRequests: 2,
    duplicateFragmentsSkipped: 0,
    messageCount: 2,
    totals: { input_tokens: 100, output_tokens: 50, cache_creation_tokens: 10, cache_read_tokens: 20 },
    naiveTotals: { input_tokens: 100, output_tokens: 50, cache_creation_tokens: 10, cache_read_tokens: 20 },
    cache_savings_usd: 0.01,
    cost_usd: 0.005,
    naiveCostUsd: 0.005,
    messages: [
      { uuid: 'm1', role: 'assistant', model: 'claude-sonnet-4-6', timestamp: '2026-05-13T12:00:00Z', request_id: 'R1', message_id: 'M1', input_tokens: 50, output_tokens: 25, cache_read_tokens: 10, cache_creation_tokens: 5, cost_usd: 0.0025, text_preview: 'hi' },
      { uuid: 'm2', role: 'assistant', model: 'claude-sonnet-4-6', timestamp: '2026-05-13T12:00:30Z', request_id: 'R2', message_id: 'M2', input_tokens: 50, output_tokens: 25, cache_read_tokens: 10, cache_creation_tokens: 5, cost_usd: 0.0025, text_preview: 'bye' },
    ],
    toolUses: [
      { messageIndex: 0, name: 'Read', tool_use_id: 'tu_1', requestId: 'R1', target: 'a.js', timestamp: '2026-05-13T12:00:00Z', line: 1 },
      { messageIndex: 1, name: 'Edit', tool_use_id: 'tu_2', requestId: 'R2', target: 'a.js', timestamp: '2026-05-13T12:00:30Z', line: 2 },
    ],
    ...overrides,
  };
}

describe('code-sessions.repository upsertSessionWithChildren', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('short-circuits with skipped=unchanged when source_mtime+parser_version match', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'cs_pre', source_mtime: '2026-05-13T12:01:30Z', parser_version: 2 }], // freshness check
      ],
    });
    const result = await upsertSessionWithChildren(sql, 'org_test', fixtureParsed(), {
      projectId: 'cp_test',
      source: 'jsonl',
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('unchanged');
    expect(result.sessionId).toBe('cs_pre');
    // Only the freshness SELECT should have hit SQL.
    expect(sql.taggedCalls.length).toBe(1);
  });

  it('proceeds when stored parser_version is older than incoming', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'cs_old', source_mtime: '2026-05-13T12:01:30Z', parser_version: 1 }], // freshness — older parser
        [{ id: 'cs_old' }],                                                            // upsert returning id
        [],                                                                            // DELETE messages
        [],                                                                            // DELETE tool_uses
        [{ id: 1001 }],                                                                // INSERT messages [0]
        [{ id: 1002 }],                                                                // INSERT messages [1]
        [],                                                                            // INSERT tool_uses [0]
        [],                                                                            // INSERT tool_uses [1]
      ],
    });
    const result = await upsertSessionWithChildren(sql, 'org_test', fixtureParsed(), {
      projectId: 'cp_test',
      source: 'jsonl',
    });
    expect(result.skipped).toBe(false);
    expect(result.sessionId).toBe('cs_old');
    expect(result.insertedMessages).toBe(2);
    expect(result.insertedToolUses).toBe(2);
  });

  it('emits the expected statement order: SELECT -> UPSERT -> DELETE msgs -> DELETE tool_uses -> N INSERT msgs RETURNING id -> N INSERT tool_uses', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [],                          // freshness check — no existing
        [{ id: 'cs_new' }],          // upsert
        [],                          // DELETE messages
        [],                          // DELETE tool_uses
        [{ id: 2001 }],              // INSERT messages [0]
        [{ id: 2002 }],              // INSERT messages [1]
        [],                          // INSERT tool_uses [0]
        [],                          // INSERT tool_uses [1]
      ],
    });
    await upsertSessionWithChildren(sql, 'org_test', fixtureParsed(), {
      projectId: 'cp_test',
      source: 'jsonl',
    });
    const order = sql.taggedCalls.map(c => c.text);
    expect(order[0]).toMatch(/SELECT id, source_mtime, parser_version[\s\S]+code_sessions/);
    expect(order[1]).toMatch(/INSERT INTO code_sessions[\s\S]+ON CONFLICT/);
    expect(order[2]).toMatch(/DELETE FROM code_session_messages/);
    expect(order[3]).toMatch(/DELETE FROM code_session_tool_uses/);
    expect(order[4]).toMatch(/INSERT INTO code_session_messages[\s\S]+RETURNING id/);
    expect(order[5]).toMatch(/INSERT INTO code_session_messages[\s\S]+RETURNING id/);
    expect(order[6]).toMatch(/INSERT INTO code_session_tool_uses/);
    expect(order[7]).toMatch(/INSERT INTO code_session_tool_uses/);
  });

  it('translates toolUses[i].messageIndex into the freshly-allocated message_id', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [],                          // freshness
        [{ id: 'cs_new' }],          // upsert
        [],                          // DELETE messages
        [],                          // DELETE tool_uses
        [{ id: 3001 }],              // message[0]
        [{ id: 3002 }],              // message[1]
        [],                          // tool_use[0]
        [],                          // tool_use[1]
      ],
    });
    await upsertSessionWithChildren(sql, 'org_test', fixtureParsed(), {
      projectId: 'cp_test',
      source: 'jsonl',
    });
    // Tool use [0] should reference message[0].id = 3001 (4th argument in the values: session_id, message_id, action_id, name, ...).
    const tu0 = sql.taggedCalls[6];
    expect(tu0.values).toContain(3001);
    const tu1 = sql.taggedCalls[7];
    expect(tu1.values).toContain(3002);
  });

  it('stamps action_id from toolUseActionMap when supplied', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [],
        [{ id: 'cs_new' }],
        [], [],
        [{ id: 4001 }], [{ id: 4002 }],
        [], [],
      ],
    });
    await upsertSessionWithChildren(sql, 'org_test', fixtureParsed(), {
      projectId: 'cp_test',
      source: 'hook',
      toolUseActionMap: { tu_1: 'ar_demo_action' },
    });
    const tu0 = sql.taggedCalls[6];
    expect(tu0.values).toContain('ar_demo_action');
    // Second tool_use had no mapping — action_id should be null.
    const tu1 = sql.taggedCalls[7];
    expect(tu1.values).toContain(null);
  });

  it('returns skipped without writing when parsed.sessionUuid is missing', async () => {
    const sql = createSqlMock();
    const result = await upsertSessionWithChildren(sql, 'org_test', { ...fixtureParsed(), sessionUuid: null }, {
      projectId: 'cp_test',
      source: 'jsonl',
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_session_uuid');
    expect(sql.taggedCalls.length).toBe(0);
  });

  it('throws when projectId is missing', async () => {
    const sql = createSqlMock();
    await expect(upsertSessionWithChildren(sql, 'org_test', fixtureParsed(), { source: 'jsonl' }))
      .rejects.toThrow(/projectId is required/);
  });
});

describe('code-sessions.repository upsertProject', () => {
  it('issues INSERT ... ON CONFLICT (org_id, slug) DO UPDATE', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'cp_new', org_id: 'org_t', slug: 'demo', cwd: 'C:/p', source_host: 'hook' }],
      ],
    });
    const row = await upsertProject(sql, 'org_t', { slug: 'demo', cwd: 'C:/p', source_host: 'hook' });
    expect(row.id).toBe('cp_new');
    const text = sql.taggedCalls[0].text;
    expect(text).toMatch(/INSERT INTO code_projects[\s\S]+ON CONFLICT \(org_id, slug\)[\s\S]+DO UPDATE/);
  });
});
