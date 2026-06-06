/**
 * Canonical JSON stringify for stable signing/verification.
 *
 * JSON.stringify is not a canonical representation of objects:
 * key order can vary depending on object construction.
 *
 * This function produces a deterministic JSON string by sorting object keys.
 * - Object keys are sorted lexicographically.
 * - Undefined object values are omitted (matching JSON.stringify behavior).
 * - Undefined array entries are encoded as null (matching JSON.stringify behavior).
 */

function canonicalize(value: unknown): string {
  if (value === null) return 'null';

  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return JSON.stringify(value);

  if (t === 'undefined') return 'null';

  if (Array.isArray(value)) {
    const parts = value.map((v) => (typeof v === 'undefined' ? 'null' : canonicalize(v)));
    return `[${parts.join(',')}]`;
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => typeof obj[k] !== 'undefined')
      .sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
    return `{${parts.join(',')}}`;
  }

  // Fallback for unsupported types (bigint, function, symbol): match JSON.stringify -> undefined
  return 'null';
}

export function canonicalJsonStringify(value: unknown): string {
  return canonicalize(value);
}
