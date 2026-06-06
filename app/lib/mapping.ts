/**
 * Dot-path request/response mapper for capability invocations.
 * Resolves $.field paths from a source object into a target shape.
 */

function resolvePath(source: Record<string, unknown>, path: unknown): unknown {
  if (typeof path !== 'string' || !path.startsWith('$.')) return undefined;
  const key = path.slice(2);
  return source[key];
}

function mapObject(source: Record<string, unknown>, mapping: unknown): Record<string, unknown> | null {
  if (!mapping || typeof mapping !== 'object') return null;
  const result: Record<string, unknown> = {};
  let hasKeys = false;

  for (const [key, value] of Object.entries(mapping as Record<string, unknown>)) {
    if (typeof value === 'string' && value.startsWith('$.')) {
      const resolved = resolvePath(source, value);
      if (resolved !== undefined) {
        result[key] = resolved;
        hasKeys = true;
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = mapObject(source, value);
      if (nested !== null) {
        result[key] = nested;
        hasKeys = true;
      }
    } else {
      result[key] = value;
      hasKeys = true;
    }
  }

  return hasKeys ? result : null;
}

export function mapRequest(source: Record<string, unknown>, mapping: unknown): Record<string, unknown> {
  if (!mapping || Object.keys(mapping as Record<string, unknown>).length === 0) return source;
  const mapped = mapObject(source, mapping);
  return mapped || source;
}

export function mapResponse(source: Record<string, unknown>, mapping: unknown): Record<string, unknown> {
  if (!mapping || Object.keys(mapping as Record<string, unknown>).length === 0) return source;
  const mapped = mapObject(source, mapping);
  return mapped || source;
}

export function resolveEndpointUrl(url: string, settings: Record<string, unknown>): string {
  return url.replace(/\$\{([^}]+)\}/g, (match: string, varName: string) => {
    const value = settings[varName];
    if (value === undefined || value === null || value === '') {
      const err = new Error(`Setting '${varName}' not configured for capability endpoint`) as Error & { code?: string };
      err.code = 'endpoint_not_configured';
      throw err;
    }
    return String(value);
  });
}
