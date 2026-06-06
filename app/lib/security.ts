/**
 * Security scanning utility for detecting sensitive data.
 * Ported from outbound_filter for use in API routes.
 */

interface SecurityPattern {
  name: string;
  pattern: RegExp;
  category: string;
  severity: 'critical' | 'high';
}

interface ScanFinding {
  pattern: string;
  category: string;
  severity: string;
  preview: string;
}

interface ScanResult {
  findings: ScanFinding[];
  redacted: string;
  clean: boolean;
}

export const SECURITY_PATTERNS: SecurityPattern[] = [
  { name: 'api_key_generic', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?([A-Za-z0-9_\-]{16,})['"]?/gi, category: 'api_key', severity: 'critical' },
  { name: 'aws_access_key', pattern: /AKIA[0-9A-Z]{16}/g, category: 'cloud_credential', severity: 'critical' },
  { name: 'aws_secret_key', pattern: /(?:aws)?[_-]?secret[_-]?(?:access)?[_-]?key\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi, category: 'cloud_credential', severity: 'critical' },
  { name: 'github_token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, category: 'token', severity: 'critical' },
  { name: 'openai_key', pattern: /sk-[A-Za-z0-9]{20,}/g, category: 'api_key', severity: 'critical' },
  { name: 'anthropic_key', pattern: /sk-ant-[A-Za-z0-9_\-]{20,}/g, category: 'api_key', severity: 'critical' },
  { name: 'stripe_key', pattern: /(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{24,}/g, category: 'api_key', severity: 'critical' },
  { name: 'slack_token', pattern: /xox[bpsar]-[A-Za-z0-9\-]{10,}/g, category: 'token', severity: 'critical' },
  { name: 'jwt_token', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, category: 'token', severity: 'high' },
  { name: 'private_key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, category: 'private_key', severity: 'critical' },
  { name: 'password_field', pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"]([^'"]{6,})['"]?/gi, category: 'password', severity: 'high' },
  { name: 'bearer_token', pattern: /Bearer\s+[A-Za-z0-9_\-\.]{20,}/g, category: 'token', severity: 'high' },
  { name: 'database_url', pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s'"]{10,}/gi, category: 'connection_string', severity: 'critical' },
];

/**
 * Recursively redacts sensitive data from any value (string, array, or object).
 * Strings are scanned with scanSensitiveData; nested structures are walked.
 * @param value - The value to redact.
 * @param findings - Accumulator array; push-appended with any findings.
 * @returns The redacted value (same shape as input).
 */
export function redactAny(value: unknown, findings: unknown[]): unknown {
  if (typeof value === 'string') {
    const scan = scanSensitiveData(value);
    if (!scan.clean) findings.push(...scan.findings);
    return scan.redacted;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactAny(v, findings));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactAny(v, findings);
    return out;
  }
  return value;
}

/**
 * Scans text for sensitive data.
 */
export function scanSensitiveData(text: unknown): ScanResult {
  if (!text || typeof text !== 'string') {
    return { findings: [], redacted: text as string, clean: true };
  }

  const findings: ScanFinding[] = [];
  let redacted = text;

  for (const { name, pattern, category, severity } of SECURITY_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const full = match[0];
      if (full === undefined) break;
      findings.push({ pattern: name, category, severity, preview: full.substring(0, 8) + '***' });
      redacted = redacted.replace(full, `[REDACTED:${name}]`);
    }
  }

  return { findings, redacted, clean: findings.length === 0 };
}
