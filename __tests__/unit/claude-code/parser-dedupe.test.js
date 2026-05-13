import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseSessionFile,
  PARSER_VERSION,
  _internals,
} from '@/lib/claude-code/parser.js';

const { usageKeyOf, safeTarget } = _internals;

function writeFixture(lines) {
  const tmp = path.join(os.tmpdir(), `dashclaw-parser-dedupe-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(tmp, lines.map(o => (typeof o === 'string' ? o : JSON.stringify(o))).join('\n') + '\n');
  return tmp;
}

function assistantRow({ sessionId = 'sess', uuid, requestId, messageId, model = 'claude-opus-4-7', input, output, cacheRead, cacheCreation, content = [] }) {
  return {
    type: 'assistant', sessionId, uuid, requestId,
    timestamp: '2026-05-12T12:00:00Z',
    cwd: 'C:/x',
    message: {
      role: 'assistant', model, id: messageId,
      content,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreation,
      },
    },
  };
}

describe('claude-code/parser dedup', () => {
  it('PARSER_VERSION is exported and >= 2', () => {
    expect(PARSER_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('_usageKeyOf prefers requestId, then message.id, then row uuid', () => {
    expect(usageKeyOf({ requestId: 'R', message: { id: 'M' }, uuid: 'U' }).key).toBe('req:R');
    expect(usageKeyOf({ message: { id: 'M' }, uuid: 'U' }).key).toBe('msg:M');
    expect(usageKeyOf({ uuid: 'U' }).key).toBe('row:U');
  });

  it('_safeTarget extracts file_path for Read/Edit/Write but not full Bash command', () => {
    expect(safeTarget({ name: 'Read', input: { file_path: 'C:/x.txt' } })).toBe('C:/x.txt');
    expect(safeTarget({ name: 'Edit', input: { file_path: 'a.js' } })).toBe('a.js');
    expect(safeTarget({ name: 'Bash', input: { command: 'ls -la /home/user/secret' } })).toBe('ls');
    expect(safeTarget({ name: 'TaskCreate', input: { subject: 'Build optimizer' } })).toBe('Build optimizer');
    expect(safeTarget({ name: 'WebFetch', input: { url: 'https://example.com/path?x=1' } })).toBe('example.com');
  });

  it('same requestId across 4 fragments counts usage ONCE', async () => {
    const usage = { input: 6, output: 438, cacheRead: 29248, cacheCreation: 15551 };
    const f = writeFixture([
      assistantRow({ uuid: 'u1', requestId: 'R1', messageId: 'M1', ...usage, content: [{ type: 'thinking', thinking: 'x' }] }),
      assistantRow({ uuid: 'u2', requestId: 'R1', messageId: 'M1', ...usage, content: [{ type: 'text', text: 'hi' }] }),
      assistantRow({ uuid: 'u3', requestId: 'R1', messageId: 'M1', ...usage, content: [{ type: 'tool_use', name: 'Read', id: 't1', input: { file_path: 'a.js' } }] }),
      assistantRow({ uuid: 'u4', requestId: 'R1', messageId: 'M1', ...usage, content: [{ type: 'tool_use', name: 'Edit', id: 't2', input: { file_path: 'a.js' } }] }),
    ]);
    const parsed = await parseSessionFile(f);
    expect(parsed.modelRequests).toBe(1);
    expect(parsed.duplicateFragmentsSkipped).toBe(3);
    expect(parsed.totals.input_tokens).toBe(6);
    expect(parsed.totals.output_tokens).toBe(438);
    expect(parsed.totals.cache_read_tokens).toBe(29248);
    expect(parsed.totals.cache_creation_tokens).toBe(15551);
    expect(parsed.naiveTotals.input_tokens).toBe(4 * 6);
    expect(parsed.naiveTotals.output_tokens).toBe(4 * 438);
    expect(parsed.naiveTotals.cache_read_tokens).toBe(4 * 29248);
    expect(parsed.toolUses.length).toBe(2);
    const targets = parsed.toolUses.map(t => t.target);
    expect(targets).toEqual(['a.js', 'a.js']);
    fs.unlinkSync(f);
  });

  it('message.id fallback when requestId absent', async () => {
    const usage = { input: 10, output: 20, cacheRead: 100, cacheCreation: 100 };
    const f = writeFixture([
      assistantRow({ uuid: 'u1', messageId: 'M1', ...usage, content: [] }),
      assistantRow({ uuid: 'u2', messageId: 'M1', ...usage, content: [] }),
      assistantRow({ uuid: 'u3', messageId: 'M1', ...usage, content: [] }),
    ]);
    const parsed = await parseSessionFile(f);
    expect(parsed.modelRequests).toBe(1);
    expect(parsed.duplicateFragmentsSkipped).toBe(2);
    expect(parsed.totals.input_tokens).toBe(10);
    fs.unlinkSync(f);
  });

  it('distinct requestIds with identical usage are counted separately', async () => {
    const usage = { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 };
    const f = writeFixture([
      assistantRow({ uuid: 'u1', requestId: 'A', messageId: 'mA', ...usage }),
      assistantRow({ uuid: 'u2', requestId: 'B', messageId: 'mB', ...usage }),
      assistantRow({ uuid: 'u3', requestId: 'C', messageId: 'mC', ...usage }),
    ]);
    const parsed = await parseSessionFile(f);
    expect(parsed.modelRequests).toBe(3);
    expect(parsed.duplicateFragmentsSkipped).toBe(0);
    expect(parsed.totals.input_tokens).toBe(3);
    expect(parsed.totals.output_tokens).toBe(6);
    fs.unlinkSync(f);
  });

  it('cost and cache_savings come from deduped usage, never row-count', async () => {
    const usage = { input: 0, output: 1000, cacheRead: 10000, cacheCreation: 0 };
    const f = writeFixture([
      assistantRow({ uuid: 'u1', requestId: 'R1', messageId: 'M1', ...usage }),
      assistantRow({ uuid: 'u2', requestId: 'R1', messageId: 'M1', ...usage }),
      assistantRow({ uuid: 'u3', requestId: 'R1', messageId: 'M1', ...usage }),
    ]);
    const parsed = await parseSessionFile(f);
    // Opus pricing: output 75/M, cache_read 1.50/M -> 1000*75/1e6 + 10000*1.5/1e6 = 0.075 + 0.015 = 0.09
    expect(Math.abs(parsed.cost_usd - 0.09)).toBeLessThan(1e-9);
    expect(Math.abs(parsed.naiveCostUsd - 0.27)).toBeLessThan(1e-9);
    // Cache savings: 10000 * (15 - 1.5)/1M = 0.135
    expect(Math.abs(parsed.cache_savings_usd - 0.135)).toBeLessThan(1e-9);
    fs.unlinkSync(f);
  });
});
