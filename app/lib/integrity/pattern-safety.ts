/**
 * Shared ReDoS / pattern-safety guard for caller-supplied regex source.
 *
 * Extracted to a leaf module so BOTH the non-fabrication verifier (verify.ts)
 * and the operational-token extractor (extract.ts) validate caller-supplied
 * patterns through ONE guard. `extract.ts`'s `extractPattern` previously did an
 * unguarded `new RegExp(userPattern)` (CodeQL js/regex-injection); routing it
 * through `assertSafePattern` closes that without an extract -> verify import
 * cycle. forbiddenPatterns / extract.patterns come from the source-of-truth,
 * which in the default config is request-body input.
 */

export const MAX_PATTERN_LENGTH = 1000;

interface CodedError extends Error {
  code?: string;
}

/**
 * Conservative catastrophic-backtracking (ReDoS) guard for caller-supplied
 * patterns. A pattern that nests an unbounded quantifier inside a quantified
 * group (star height >= 2, e.g. `(a+)+`) can hang the worker — and a try/catch
 * only catches THROWS, not a spinning regex. So we reject such patterns up
 * front; the throw is caught by the caller and fails closed (engine_error
 * block). A malformed / unsafe ruleset blocks, never runs.
 */
export function assertSafePattern(src: string): void {
  if (typeof src !== 'string' || src.length > MAX_PATTERN_LENGTH) {
    const err: CodedError = new Error('non_fabrication: unsafe or oversized pattern');
    err.code = 'UNSAFE_PATTERN';
    throw err;
  }
  const stack: Array<{ hasQuant: boolean }> = []; // per group-nesting level: does the body contain a quantifier?
  let escaped = false;
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '(') { stack.push({ hasQuant: false }); continue; }
    if (c === ')') {
      const grp = stack.pop() || { hasQuant: false };
      const rest = src.slice(i + 1);
      const quantified =
        rest[0] === '+' || rest[0] === '*' || /^\{\d+,\d*\}/.test(rest);
      if (quantified && grp.hasQuant) {
        const err: CodedError = new Error('non_fabrication: unsafe nested-quantifier pattern');
        err.code = 'UNSAFE_PATTERN';
        throw err;
      }
      if (stack.length && (grp.hasQuant || quantified)) {
        (stack[stack.length - 1] as { hasQuant: boolean }).hasQuant = true;
      }
      continue;
    }
    if (c === '+' || c === '*') {
      if (stack.length) (stack[stack.length - 1] as { hasQuant: boolean }).hasQuant = true;
      continue;
    }
    if (c === '{') {
      // An unbounded upper bound ({n,}) counts as a quantifier for backtracking.
      if (/^\{\d+,\}/.test(src.slice(i)) && stack.length) {
        (stack[stack.length - 1] as { hasQuant: boolean }).hasQuant = true;
      }
    }
  }
}
