/**
 * Convert a glob pattern (with `*` wildcards) to a safe RegExp.
 * Escapes all regex metacharacters except `*`, then converts `*` to `.*`.
 * Prevents ReDoS from user/admin-supplied patterns like `(a+)+$`.
 */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
}
