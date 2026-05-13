import { describe, it, expect } from 'vitest';
import { buildAudit } from '@/lib/claude-code/audit.js';
import { parseSessionLines, PARSER_VERSION } from '@/lib/claude-code/parser.js';

describe('claude-code/audit', () => {
  it('buildAudit on stored row only (no livedParse) returns counts and totals from the row', () => {
    const session = {
      id: 'cs_1',
      session_uuid: 'u1',
      source_file: '/tmp/x.jsonl',
      parser_version: 2,
      jsonl_records: 10,
      model_requests: 4,
      message_count: 4,
      duplicate_fragments_skipped: 2,
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 200,
      cache_creation_tokens: 10,
      cost_usd: 0.12,
      cache_savings_usd: 0.02,
      naive_input_tokens: 200,
      naive_output_tokens: 100,
      naive_cache_read_tokens: 400,
      naive_cache_creation_tokens: 20,
      naive_cost_usd: 0.24,
    };
    const audit = buildAudit({ session });
    expect(audit.sessionId).toBe('cs_1');
    expect(audit.parserVersionExpected).toBe(PARSER_VERSION);
    expect(audit.needs_reingest).toBe(false);
    expect(audit.deduped_totals.input_tokens).toBe(100);
    expect(audit.naive_totals.output_tokens).toBe(100);
    expect(audit.top_requests).toEqual([]);
    expect(audit.notes.length).toBeGreaterThan(0);
  });

  it('buildAudit flags needs_reingest when stored parser_version < PARSER_VERSION', () => {
    const session = { id: 'cs_2', session_uuid: 'u2', source_file: '/tmp/y.jsonl', parser_version: 1 };
    const audit = buildAudit({ session });
    expect(audit.needs_reingest).toBe(true);
  });

  it('buildAudit returns top requests and live counts when livedParse is provided', () => {
    const usage = { input_tokens: 0, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const lines = [
      JSON.stringify({ type: 'assistant', sessionId: 's2', uuid: 'u1', requestId: 'R1', message: { role: 'assistant', model: 'claude-opus-4-7', id: 'M', content: [], usage } }),
      JSON.stringify({ type: 'assistant', sessionId: 's2', uuid: 'u2', requestId: 'R1', message: { role: 'assistant', model: 'claude-opus-4-7', id: 'M', content: [], usage } }),
    ];
    const parsed = parseSessionLines(lines);
    const session = {
      id: 'cs_3',
      session_uuid: parsed.sessionUuid,
      source_file: '/tmp/y.jsonl',
      parser_version: PARSER_VERSION,
      jsonl_records: parsed.jsonlRecords,
      model_requests: parsed.modelRequests,
      message_count: parsed.messageCount,
      duplicate_fragments_skipped: parsed.duplicateFragmentsSkipped,
      input_tokens: parsed.totals.input_tokens,
      output_tokens: parsed.totals.output_tokens,
      cache_read_tokens: parsed.totals.cache_read_tokens,
      cache_creation_tokens: parsed.totals.cache_creation_tokens,
      cost_usd: parsed.cost_usd,
      cache_savings_usd: parsed.cache_savings_usd,
      naive_output_tokens: parsed.naiveTotals.output_tokens,
    };
    const audit = buildAudit({ session, livedParse: parsed });
    expect(audit.counts.model_requests).toBe(1);
    expect(audit.counts.duplicate_fragments_skipped).toBe(1);
    expect(audit.live_counts.model_requests).toBe(1);
    expect(audit.naive_totals.output_tokens).toBe(200);
    expect(audit.deduped_totals.output_tokens).toBe(100);
    expect(Array.isArray(audit.top_requests)).toBe(true);
    expect(audit.top_requests.length).toBe(1);
    expect(audit.top_requests[0].request_id).toBe('R1');
  });
});
