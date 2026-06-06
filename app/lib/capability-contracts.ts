const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_TYPES = new Set(['none', 'bearer', 'api_key']);
const BACKOFF_STRATEGIES = new Set(['none', 'fixed', 'exponential']);
const SCHEMA_TYPES = new Set(['object', 'string', 'number', 'boolean', 'array']);

type PlainObject = Record<string, unknown>;

interface CodedError extends Error {
  code?: string;
}

function isPlainObject(value: unknown): value is PlainObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fail(message: string, code: string): never {
  const err: CodedError = new Error(message);
  err.code = code;
  throw err;
}

function validateSchemaDefinition(schema: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(schema)) {
    errors.push(`${path} must be an object`);
    return;
  }

  if (!SCHEMA_TYPES.has(schema.type as string)) {
    errors.push(`${path}.type must be one of ${Array.from(SCHEMA_TYPES).join(', ')}`);
    return;
  }

  if (schema.type === 'object') {
    if (schema.properties !== undefined && !isPlainObject(schema.properties)) {
      errors.push(`${path}.properties must be an object`);
    }
    if (schema.required !== undefined) {
      if (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== 'string')) {
        errors.push(`${path}.required must be an array of strings`);
      }
    }
    if (isPlainObject(schema.properties)) {
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        validateSchemaDefinition(propertySchema, `${path}.properties.${key}`, errors);
      }
    }
  }

  if (schema.type === 'array' && schema.items !== undefined) {
    validateSchemaDefinition(schema.items, `${path}.items`, errors);
  }
}

export function validateInvocationSchema(sourceType: string, schema: unknown): void {
  if (sourceType !== 'http_api') {
    return;
  }

  if (!isPlainObject(schema)) {
    fail('invocation_schema must be an object', 'capability_contract_invalid');
  }

  const errors: string[] = [];

  if (typeof schema.endpoint !== 'string' || schema.endpoint.trim().length === 0) {
    errors.push('invocation_schema.endpoint is required for http_api capabilities');
  }

  if (schema.method !== undefined) {
    const method = String(schema.method).toUpperCase();
    if (!HTTP_METHODS.has(method)) {
      errors.push(`invocation_schema.method must be one of ${Array.from(HTTP_METHODS).join(', ')}`);
    }
  }

  if (schema.auth !== undefined) {
    if (!isPlainObject(schema.auth)) {
      errors.push('invocation_schema.auth must be an object');
    } else {
      if (!AUTH_TYPES.has(schema.auth.type as string)) {
        errors.push(`invocation_schema.auth.type must be one of ${Array.from(AUTH_TYPES).join(', ')}`);
      }
      if (
        (schema.auth.type === 'bearer' || schema.auth.type === 'api_key') &&
        (typeof schema.auth.token_setting !== 'string' || schema.auth.token_setting.trim().length === 0)
      ) {
        errors.push('invocation_schema.auth.token_setting is required for bearer and api_key auth');
      }
    }
  }

  if (schema.timeout_ms !== undefined) {
    if (!Number.isInteger(schema.timeout_ms) || (schema.timeout_ms as number) < 1000 || (schema.timeout_ms as number) > 300000) {
      errors.push('invocation_schema.timeout_ms must be an integer between 1000 and 300000');
    }
  }

  if (schema.retry_policy !== undefined) {
    if (!isPlainObject(schema.retry_policy)) {
      errors.push('invocation_schema.retry_policy must be an object');
    } else {
      const rp = schema.retry_policy;
      if (rp.max_retries !== undefined) {
        if (!Number.isInteger(rp.max_retries) || (rp.max_retries as number) < 0 || (rp.max_retries as number) > 5) {
          errors.push('invocation_schema.retry_policy.max_retries must be an integer between 0 and 5');
        }
      }
      if (rp.backoff !== undefined && !BACKOFF_STRATEGIES.has(rp.backoff as string)) {
        errors.push(`invocation_schema.retry_policy.backoff must be one of ${Array.from(BACKOFF_STRATEGIES).join(', ')}`);
      }
      if (rp.base_delay_ms !== undefined) {
        if (!Number.isInteger(rp.base_delay_ms) || (rp.base_delay_ms as number) < 100 || (rp.base_delay_ms as number) > 30000) {
          errors.push('invocation_schema.retry_policy.base_delay_ms must be an integer between 100 and 30000');
        }
      }
      if (rp.max_delay_ms !== undefined) {
        if (!Number.isInteger(rp.max_delay_ms) || (rp.max_delay_ms as number) < 100 || (rp.max_delay_ms as number) > 60000) {
          errors.push('invocation_schema.retry_policy.max_delay_ms must be an integer between 100 and 60000');
        }
      }
      if (rp.retryable_status_codes !== undefined) {
        if (!Array.isArray(rp.retryable_status_codes) || rp.retryable_status_codes.some(
          (code) => !Number.isInteger(code) || code < 400 || code > 599
        )) {
          errors.push('invocation_schema.retry_policy.retryable_status_codes must be an array of HTTP status codes (400-599)');
        }
      }
    }
  }

  if (schema.circuit_breaker !== undefined) {
    if (!isPlainObject(schema.circuit_breaker)) {
      errors.push('invocation_schema.circuit_breaker must be an object');
    } else {
      const cb = schema.circuit_breaker;
      if (cb.enabled !== undefined && typeof cb.enabled !== 'boolean') {
        errors.push('invocation_schema.circuit_breaker.enabled must be a boolean');
      }
      if (cb.consecutive_failures !== undefined) {
        if (!Number.isInteger(cb.consecutive_failures) || (cb.consecutive_failures as number) < 1 || (cb.consecutive_failures as number) > 50) {
          errors.push('invocation_schema.circuit_breaker.consecutive_failures must be an integer between 1 and 50');
        }
      }
    }
  }

  if (schema.request_mapping !== undefined && !isPlainObject(schema.request_mapping)) {
    errors.push('invocation_schema.request_mapping must be an object');
  }

  if (schema.response_mapping !== undefined && !isPlainObject(schema.response_mapping)) {
    errors.push('invocation_schema.response_mapping must be an object');
  }

  if (schema.input_schema !== undefined) {
    validateSchemaDefinition(schema.input_schema, 'input_schema', errors);
  }

  if (schema.output_schema !== undefined) {
    validateSchemaDefinition(schema.output_schema, 'output_schema', errors);
  }

  if (errors.length > 0) {
    fail(errors[0] as string, 'capability_contract_invalid');
  }
}

function validateValueAgainstSchema(value: unknown, schema: PlainObject, path: string): string | null {
  switch (schema.type) {
    case 'object': {
      if (!isPlainObject(value)) {
        return `${path} must be an object`;
      }

      for (const key of (schema.required as string[] | undefined) || []) {
        if (value[key] === undefined) {
          return `${path}.${key} is required`;
        }
      }

      for (const [key, propertySchema] of Object.entries((schema.properties as PlainObject | undefined) || {})) {
        if (value[key] !== undefined) {
          const nestedError = validateValueAgainstSchema(value[key], propertySchema as PlainObject, `${path}.${key}`);
          if (nestedError) return nestedError;
        }
      }
      return null;
    }
    case 'string':
      return typeof value === 'string' ? null : `${path} must be a string`;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : `${path} must be a number`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `${path} must be a boolean`;
    case 'array':
      if (!Array.isArray(value)) {
        return `${path} must be an array`;
      }
      if (schema.items) {
        for (let i = 0; i < value.length; i += 1) {
          const nestedError = validateValueAgainstSchema(value[i], schema.items as PlainObject, `${path}[${i}]`);
          if (nestedError) return nestedError;
        }
      }
      return null;
    default:
      return `${path} has unsupported schema type`;
  }
}

export function assertPayloadMatchesSchema(payload: unknown, schema: PlainObject | null | undefined, kind: string): void {
  if (!schema || Object.keys(schema).length === 0) {
    return;
  }

  const error = validateValueAgainstSchema(payload, schema, kind);
  if (!error) {
    return;
  }

  const code = kind === 'input' ? 'capability_input_invalid' : 'capability_output_invalid';
  fail(error, code);
}
