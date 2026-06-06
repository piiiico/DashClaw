/**
 * Variable substitution engine for workflow step configs.
 *
 * Resolves patterns like:
 *   ${variables.query}
 *   ${steps.step_1.output.answer}
 *   ${steps.step_1.output.chunks[0].content}
 */

function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveString(str: string, context: unknown): unknown {
  // Check if entire string is a single variable — return original type
  const singleVarMatch = str.match(/^\$\{([^}]+)\}$/);
  if (singleVarMatch) {
    const resolved = resolvePath(context, singleVarMatch[1] ?? '');
    return resolved !== undefined ? resolved : str;
  }

  // Mixed string — replace all ${...} with string values.
  //
  // Objects and arrays get JSON-stringified rather than passed through
  // String(), which would produce the infamous "[object Object]". This
  // matters for LLM prompts like `${steps.search.output}` that expect
  // the step's actual output data, not a placeholder.
  return str.replace(/\$\{([^}]+)\}/g, (match, varPath) => {
    const resolved = resolvePath(context, varPath);
    if (resolved === undefined) return match;
    if (typeof resolved === 'string') return resolved;
    if (
      resolved === null ||
      typeof resolved === 'number' ||
      typeof resolved === 'boolean'
    ) {
      return String(resolved);
    }
    // Object or array — serialize so the downstream consumer (often an
    // LLM) sees real content instead of "[object Object]".
    try {
      return JSON.stringify(resolved, null, 2);
    } catch {
      return String(resolved);
    }
  });
}

export function resolveVars(value: unknown, context: unknown): unknown {
  if (typeof value === 'string') {
    return resolveString(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveVars(item, context));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = resolveVars(v, context);
    }
    return result;
  }
  return value;
}
