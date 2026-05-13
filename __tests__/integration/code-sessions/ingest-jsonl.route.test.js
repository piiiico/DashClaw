import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../../helpers.js';

const {
  mockSql,
  mockUpsertProject,
  mockUpsertSessionWithChildren,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockUpsertProject: vi.fn(),
  mockUpsertSessionWithChildren: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/code-sessions.repository.js', () => ({
  upsertProject: mockUpsertProject,
  upsertSessionWithChildren: mockUpsertSessionWithChildren,
}));

const { POST } = await import('@/api/code-sessions/ingest-jsonl/route.js');

function jsonlRecord(overrides = {}) {
  const usage = overrides.usage || {
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  return JSON.stringify({
    type: 'assistant',
    sessionId: overrides.sessionId || 'sess-abc',
    uuid: overrides.uuid || 'u1',
    requestId: overrides.requestId || 'R1',
    timestamp: '2026-05-13T12:00:00Z',
    cwd: 'C:/Projects/Demo',
    message: {
      role: 'assistant',
      model: overrides.model || 'claude-sonnet-4-6',
      id: overrides.messageId || 'M1',
      content: overrides.content || [{ type: 'tool_use', name: 'Read', id: 'tu_1', input: { file_path: 'a.js' } }],
      usage,
    },
  });
}

function fixtureRequest(body) {
  return makeRequest('http://test/api/code-sessions/ingest-jsonl', {
    headers: { 'x-org-id': 'org_unit_test' },
    body,
  });
}

beforeEach(() => {
  mockSql.mockClear();
  mockUpsertProject.mockReset();
  mockUpsertSessionWithChildren.mockReset();
  mockUpsertProject.mockResolvedValue({ id: 'cp_unit', slug: 'demo' });
  mockUpsertSessionWithChildren.mockResolvedValue({
    sessionId: 'cs_unit',
    skipped: false,
    reason: 'created',
    insertedMessages: 1,
    insertedToolUses: 1,
  });
});

describe('POST /api/code-sessions/ingest-jsonl', () => {
  it('rejects body without jsonl_lines', async () => {
    const res = await POST(fixtureRequest({ project: { slug: 'demo' } }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('missing_jsonl_lines');
  });

  it('rejects invalid source_host', async () => {
    const res = await POST(fixtureRequest({
      project: { slug: 'demo', source_host: 'sneaky' },
      jsonl_lines: [],
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_source_host');
  });

  it('rejects JSONL with no sessionId in any assistant record', async () => {
    const res = await POST(fixtureRequest({
      project: { slug: 'demo', source_host: 'jsonl' },
      jsonl_lines: ['this is junk', '{"type":"unknown"}'],
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('no_session_uuid_in_jsonl');
  });

  it('rejects mismatched session_uuid from client vs parsed', async () => {
    const res = await POST(fixtureRequest({
      project: { slug: 'demo', source_host: 'jsonl' },
      session_uuid: 'client-said-different',
      jsonl_lines: [jsonlRecord()],
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('mismatched_session_uuid');
    expect(json.parser_session_uuid).toBe('sess-abc');
  });

  it('happy path: invokes repository with parsed payload and returns shape', async () => {
    const res = await POST(fixtureRequest({
      project: { slug: 'demo', cwd: 'C:/Projects/Demo', source_host: 'jsonl' },
      session_uuid: 'sess-abc',
      source_file: '/tmp/demo.jsonl',
      source_mtime: '2026-05-13T12:00:00Z',
      jsonl_lines: [jsonlRecord()],
      tool_use_action_map: { tu_1: 'ar_demo_1' },
    }));
    expect(res.status).toBe(200);
    expect(mockUpsertProject).toHaveBeenCalledWith(mockSql, 'org_unit_test', {
      slug: 'demo',
      cwd: 'C:/Projects/Demo',
      source_host: 'jsonl',
    });
    expect(mockUpsertSessionWithChildren).toHaveBeenCalledTimes(1);
    const [, orgArg, parsed, opts] = mockUpsertSessionWithChildren.mock.calls[0];
    expect(orgArg).toBe('org_unit_test');
    expect(parsed.sessionUuid).toBe('sess-abc');
    expect(parsed.toolUses[0].tool_use_id).toBe('tu_1');
    expect(opts.projectId).toBe('cp_unit');
    expect(opts.source).toBe('jsonl');
    expect(opts.toolUseActionMap.tu_1).toBe('ar_demo_1');
    const json = await res.json();
    expect(json.session.id).toBe('cs_unit');
    expect(json.session.session_uuid).toBe('sess-abc');
    expect(json.parser.model_primary).toBe('claude-sonnet-4-6');
  });

  it('derives slug from cwd basename when project.slug is missing', async () => {
    await POST(fixtureRequest({
      project: { source_host: 'hook', cwd: 'C:/Projects/MyApp' },
      jsonl_lines: [jsonlRecord()],
    }));
    const slug = mockUpsertProject.mock.calls[0][2].slug;
    expect(slug).toBe('MyApp');
  });

  it('honours org isolation via x-org-id header', async () => {
    const reqA = makeRequest('http://test/api/code-sessions/ingest-jsonl', {
      headers: { 'x-org-id': 'org_a' },
      body: {
        project: { slug: 'demo', source_host: 'jsonl' },
        jsonl_lines: [jsonlRecord()],
      },
    });
    const reqB = makeRequest('http://test/api/code-sessions/ingest-jsonl', {
      headers: { 'x-org-id': 'org_b' },
      body: {
        project: { slug: 'demo', source_host: 'jsonl' },
        jsonl_lines: [jsonlRecord()],
      },
    });
    await POST(reqA);
    await POST(reqB);
    expect(mockUpsertProject.mock.calls[0][1]).toBe('org_a');
    expect(mockUpsertProject.mock.calls[1][1]).toBe('org_b');
  });

  it('surfaces "skipped: true, reason: unchanged" passthrough when the repository skips re-ingest', async () => {
    mockUpsertSessionWithChildren.mockResolvedValue({
      sessionId: 'cs_existing',
      skipped: true,
      reason: 'unchanged',
    });
    const res = await POST(fixtureRequest({
      project: { slug: 'demo', source_host: 'jsonl' },
      jsonl_lines: [jsonlRecord()],
      source_mtime: '2026-05-13T12:00:00Z',
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.skipped).toBe(true);
    expect(json.session.reason).toBe('unchanged');
  });

  it('counts parser_skipped for malformed lines', async () => {
    const res = await POST(fixtureRequest({
      project: { slug: 'demo', source_host: 'jsonl' },
      jsonl_lines: [jsonlRecord(), 'not json at all', '{"type":"unknown"}'],
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.parser.parser_skipped).toBe(1);
  });
});
