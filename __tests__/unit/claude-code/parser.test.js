import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseSessionFile,
  parseSessionLines,
  _internals,
} from '@/lib/claude-code/parser.js';

const { safeParse, extractToolUses, previewText } = _internals;

function writeFixture(lines) {
  const tmp = path.join(os.tmpdir(), `dashclaw-parser-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  const body = lines.map(o => (typeof o === 'string' ? o : JSON.stringify(o))).join('\n') + '\n';
  fs.writeFileSync(tmp, body);
  return tmp;
}

describe('claude-code/parser', () => {
  it('_safeParse handles bad JSON gracefully', () => {
    expect(safeParse('{not json')).toBe(null);
    expect(safeParse('{"a":1}')).toEqual({ a: 1 });
  });

  it('_extractToolUses returns tool_use entries only with name+evidence fields', () => {
    const r = extractToolUses([
      { type: 'text', text: 'hi' },
      { type: 'tool_use', name: 'Read', id: 'tu_1', input: { file_path: 'a.js' } },
      { type: 'thinking', thinking: 'x' },
      { type: 'tool_use', name: 'Edit' },
    ]);
    expect(r.length).toBe(2);
    expect(r[0].name).toBe('Read');
    expect(r[0].tool_use_id).toBe('tu_1');
    expect(r[0].target).toBe('a.js');
    expect(r[1].name).toBe('Edit');
  });

  it('_previewText pulls first text block', () => {
    const t = previewText([
      { type: 'tool_use', name: 'Read' },
      { type: 'text', text: 'hello world' },
    ]);
    expect(t).toBe('hello world');
  });

  it('parseSessionFile aggregates usage, model, tools, timestamps', async () => {
    const file = writeFixture([
      { type: 'last-prompt', sessionId: 'sess-1' },
      {
        type: 'assistant',
        sessionId: 'sess-1',
        uuid: 'u1',
        timestamp: '2026-05-01T12:00:00Z',
        cwd: 'C:/Projects/Demo',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-7',
          content: [
            { type: 'text', text: 'reading...' },
            { type: 'tool_use', name: 'Read' },
          ],
          usage: {
            input_tokens: 100,
            output_tokens: 200,
            cache_creation_input_tokens: 1000,
            cache_read_input_tokens: 4000,
          },
        },
      },
      {
        type: 'assistant',
        sessionId: 'sess-1',
        uuid: 'u2',
        timestamp: '2026-05-01T12:00:30Z',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-7',
          content: [
            { type: 'tool_use', name: 'Read' },
            { type: 'tool_use', name: 'Read' },
          ],
          usage: {
            input_tokens: 50,
            output_tokens: 100,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 4000,
          },
        },
      },
      'this line is junk',
    ]);
    const r = await parseSessionFile(file);
    expect(r.sessionUuid).toBe('sess-1');
    expect(r.cwd).toBe('C:/Projects/Demo');
    expect(r.modelPrimary).toBe('claude-opus-4-7');
    expect(r.totals.input_tokens).toBe(150);
    expect(r.totals.output_tokens).toBe(300);
    expect(r.totals.cache_creation_tokens).toBe(1000);
    expect(r.totals.cache_read_tokens).toBe(8000);
    expect(r.messageCount).toBe(2);
    expect(r.toolUses.length).toBe(3);
    expect(r.toolUses[0].name).toBe('Read');
    expect(r.skippedLines).toBe(1);
    expect(r.cost_usd).toBeGreaterThan(0);
    expect(r.cache_savings_usd).toBeGreaterThan(0);
    expect(r.startedAt).toBe('2026-05-01T12:00:00Z');
    expect(r.endedAt).toBe('2026-05-01T12:00:30Z');
    fs.unlinkSync(file);
  });

  it('parseSessionFile tolerates missing usage on user records', async () => {
    const file = writeFixture([
      {
        type: 'user',
        sessionId: 'sess-2',
        uuid: 'u1',
        timestamp: '2026-05-01T00:00:00Z',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      },
    ]);
    const r = await parseSessionFile(file);
    expect(r.messageCount).toBe(1);
    expect(r.cost_usd).toBe(0);
    expect(r.totals.input_tokens).toBe(0);
    fs.unlinkSync(file);
  });

  it('parseSessionLines produces same session shape as parseSessionFile', async () => {
    const records = [
      {
        type: 'assistant',
        sessionId: 'sess-A',
        uuid: 'u1',
        timestamp: '2026-05-01T00:00:00Z',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'tool_use', name: 'Read' }],
          usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      },
    ];
    const file = writeFixture(records);
    const lines = records.map(r => JSON.stringify(r));
    const fromFile = await parseSessionFile(file);
    const fromLines = parseSessionLines(lines);
    fs.unlinkSync(file);
    expect(fromLines.sessionUuid).toBe(fromFile.sessionUuid);
    expect(fromLines.modelPrimary).toBe(fromFile.modelPrimary);
    expect(fromLines.totals).toEqual(fromFile.totals);
    expect(fromLines.toolUses.length).toBe(fromFile.toolUses.length);
    expect(fromLines.messageCount).toBe(fromFile.messageCount);
  });
});
