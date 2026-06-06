/**
 * Shared parsers for fields that the storage layer writes via JSON.stringify.
 *
 * Many DB columns hold JSON-stringified arrays/objects (action.side_effects,
 * action.systems_touched, guard.matched_policies, etc.). Rendering them
 * directly in JSX produces literal `[]` / `{}` strings, and a truthy guard
 * like `{x.field && (...)}` fires for the empty-string cases. Always parse
 * through one of these helpers and check `.length` / `Object.keys` before
 * rendering.
 */

export function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
