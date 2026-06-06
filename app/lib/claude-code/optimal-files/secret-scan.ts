/**
 * Shared secret-redaction layer used by every Optimal Files generator before
 * content is returned to the user or written to disk. Single source of truth
 * for the pattern table.
 *
 * `scanForSecrets(content)` returns:
 *   { status, redactions, redacted }
 * where:
 *   status: 'passed' (no matches) | 'redacted' (matches found and replaced)
 *   redactions: integer count of replacements
 *   redacted: the input content with every match swapped for <REDACTED:reason>
 *
 * Ported from AgentLens (`src/optimal-files/secret-scan.js`).
 */

interface SecretPattern {
  name: string;
  re: RegExp;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  { name: 'stripe_test',  re: /sk_test_[A-Za-z0-9]{8,}/g },
  { name: 'stripe_live',  re: /sk_live_[A-Za-z0-9]{8,}/g },
  { name: 'stripe_webhook', re: /whsec_[A-Za-z0-9]{8,}/g },
  { name: 'openai_key',   re: /sk-[A-Za-z0-9]{20,}/g },
  { name: 'anthropic_key', re: /sk-ant-[A-Za-z0-9_\-]{20,}/g },
  { name: 'github_pat',   re: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g },
  { name: 'aws_access',   re: /AKIA[0-9A-Z]{16}/g },
  { name: 'jwt',          re: /eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}/g },
  { name: 'private_key',  re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'env_assign',   re: /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|CRED|AUTH))\s*=\s*['"]?[^\s'"\n]+/g },
];

export interface SecretScanResult {
  status: 'passed' | 'redacted';
  redactions: number;
  redacted: string;
}

export function scanForSecrets(content: unknown): SecretScanResult {
  let redactions = 0;
  let out = String(content == null ? '' : content);
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p.re, (_match: string, captured?: string) => {
      redactions++;
      if (p.name === 'env_assign' && captured) return `${captured}=<REDACTED:${p.name}>`;
      return `<REDACTED:${p.name}>`;
    });
  }
  return {
    status: redactions === 0 ? 'passed' : 'redacted',
    redactions,
    redacted: out,
  };
}

interface ScannableFile {
  content?: unknown;
  secretScan?: { status: string; redactions: number };
  [key: string]: unknown;
}

// Convenience wrapper: scan a bundle of {path, content, ...} files in-place
// and attach a `.secretScan` result to each. Mutates the content with the
// redacted version so downstream writes are always safe.
export function scanFiles<T extends ScannableFile>(files: T[]): T[] {
  for (const f of files) {
    if (typeof f.content !== 'string') {
      f.secretScan = { status: 'passed', redactions: 0 };
      continue;
    }
    const scan = scanForSecrets(f.content);
    f.content = scan.redacted;
    f.secretScan = { status: scan.status, redactions: scan.redactions };
  }
  return files;
}
