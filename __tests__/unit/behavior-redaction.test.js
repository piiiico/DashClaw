import { describe, it, expect } from 'vitest';
import { redactString, redactPath, redactSample } from '@/lib/behavior/redaction.js';

describe('behavior/redaction', () => {
  it('scrubs anthropic, openai, stripe, github, aws keys and JWTs', () => {
    const samples = [
      'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAA',
      'sk-1234567890ABCDEFGHIJKLMNOP',
      'sk_live_AAAAAAAAAAAAAAAA',
      'ghp_AAAAAAAAAAAAAAAAAAAAAAAA',
      'AKIAABCDEFGHIJKLMNOP',
      'eyJhbGciOiAxMjM0NTY3ODkw.eyJzdWIiOiAxMjM0NTY3ODkw.c2lnbmF0dXJlMTIzNDU2Nzg5MA',
    ];
    for (const s of samples) {
      const out = redactString(`value=${s} end`);
      expect(out).toContain('<REDACTED:');
      expect(out).not.toContain(s);
    }
  });

  it('scrubs env-style secret assignments but keeps the variable name', () => {
    const out = redactString('ANTHROPIC_API_KEY=sk-ant-secretvalue123456');
    expect(out).toContain('ANTHROPIC_API_KEY=<REDACTED:env_assign>');
    expect(out).not.toContain('secretvalue');
  });

  it('leaves benign command shapes intact', () => {
    expect(redactString('git push --force')).toBe('git push --force');
  });

  it('bounds field length to 400 chars', () => {
    const out = redactString('a'.repeat(5000));
    expect(out.length).toBe(400);
  });

  it('redactPath normalizes backslashes', () => {
    expect(redactPath('app\\api\\auth\\route.js')).toBe('app/api/auth/route.js');
  });

  it('redactSample scrubs string + path-list fields and bounds list size', () => {
    const sample = {
      event_id: 'bse_1',
      agent_id: 'a',
      command_shape: 'export TOKEN=ghp_AAAAAAAAAAAAAAAAAAAAAAAA',
      write_paths: ['app/secrets/x.js', 'sk-ant-AAAAAAAAAAAAAAAAAAAAAAAA/path'],
      read_paths: Array.from({ length: 100 }, (_, i) => `f${i}.js`),
    };
    const out = redactSample(sample);
    expect(out.command_shape).toContain('<REDACTED:');
    expect(out.write_paths.join(' ')).not.toContain('sk-ant-AAAA');
    expect(out.read_paths.length).toBeLessThanOrEqual(50);
  });

  it('never throws on malformed input', () => {
    expect(() => redactSample(null)).not.toThrow();
    expect(redactSample(null)).toBe(null);
    expect(() => redactString(undefined)).not.toThrow();
  });
});
