/**
 * Hand-rolled validation for ActionRecord and related entities.
 * No external dependencies - matches existing project style.
 */

const ACTION_TYPES = [
  'build', 'deploy', 'post', 'apply', 'security', 'message', 'api',
  'calendar', 'research', 'review', 'fix', 'refactor', 'test', 'config',
  'monitor', 'alert', 'cleanup', 'sync', 'migrate', 'other'
];

const ACTION_STATUSES = ['running', 'completed', 'failed', 'cancelled', 'pending', 'pending_approval', 'blocked'];
const LOOP_TYPES = ['followup', 'question', 'dependency', 'approval', 'review', 'handoff', 'other'];
const LOOP_STATUSES = ['open', 'resolved', 'cancelled'];
const LOOP_PRIORITIES = ['low', 'medium', 'high', 'critical'];

const ACTION_RECORD_SCHEMA = {
  // Identity
  action_id:            { type: 'string', maxLength: 128 },
  agent_id:             { type: 'string', required: true, maxLength: 128 },
  agent_name:           { type: 'string', maxLength: 256 },
  swarm_id:             { type: 'string', maxLength: 128 },
  parent_action_id:     { type: 'string', maxLength: 128 },
  // Intent
  // action_type is a free-form string (max 128 chars). The ACTION_TYPES list
  // is retained for guard policy matching and UI display hints, but agent
  // frameworks use arbitrary tool names (read, write, bash, web_search, etc.)
  // that would be rejected by an enum constraint. Agents that want the
  // canonical list can check the /api/health response.
  action_type:          { type: 'string', required: true, maxLength: 128 },
  declared_goal:        { type: 'string', required: true, maxLength: 2000 },
  reasoning:            { type: 'string', maxLength: 4000 },
  authorization_scope:  { type: 'string', maxLength: 1000 },
  // Context
  trigger:              { type: 'string', maxLength: 1000 },
  systems_touched:      { type: 'array', maxItems: 50 },
  input_summary:        { type: 'string', maxLength: 4000 },
  // Action
  status:               { type: 'string', enum: ACTION_STATUSES },
  reversible:           { type: 'boolean' },
  risk_score:           { type: 'integer', min: 0, max: 100 },
  confidence:           { type: 'integer', min: 0, max: 100 },
  recommendation_id:    { type: 'string', maxLength: 128 },
  recommendation_applied: { type: 'boolean' },
  recommendation_override_reason: { type: 'string', maxLength: 500 },
  // Outcome (typically set via PATCH)
  output_summary:       { type: 'string', maxLength: 4000 },
  side_effects:         { type: 'array', maxItems: 50 },
  artifacts_created:    { type: 'array', maxItems: 100 },
  error_message:        { type: 'string', maxLength: 4000 },
  // Meta
  timestamp_start:      { type: 'string', maxLength: 64 },
  timestamp_end:        { type: 'string', maxLength: 64 },
  duration_ms:          { type: 'integer', min: 0 },
  cost_estimate:        { type: 'number', min: 0 },
  tokens_in:            { type: 'integer', min: 0 },
  tokens_out:           { type: 'integer', min: 0 },
  model:                { type: 'string', maxLength: 128 },
  // Idempotency — agent-supplied key. If a row already exists for
  // (org_id, idempotency_key), the create call returns that row instead
  // of inserting a duplicate. See docs/architecture/durable-execution-finality.md.
  idempotency_key:      { type: 'string', maxLength: 256 },
  // Non-fabrication integrity (optional). The outbound content to verify and the
  // source-of-truth it must trace to. Forwarded into the guard context for a
  // non_fabrication policy; never persisted as action_records columns.
  content:              { type: 'string', maxLength: 50000 },
  source_of_truth:      { type: 'object' },
};

const OUTCOME_FIELDS = [
  'status', 'output_summary', 'side_effects', 'artifacts_created',
  'error_message', 'timestamp_end', 'duration_ms', 'cost_estimate',
  'tokens_in', 'tokens_out', 'model'
];

const OPEN_LOOP_SCHEMA = {
  loop_id:      { type: 'string', maxLength: 128 },
  action_id:    { type: 'string', required: true, maxLength: 128 },
  loop_type:    { type: 'string', required: true, enum: LOOP_TYPES },
  description:  { type: 'string', required: true, maxLength: 2000 },
  status:       { type: 'string', enum: LOOP_STATUSES },
  priority:     { type: 'string', enum: LOOP_PRIORITIES },
  owner:        { type: 'string', maxLength: 256 },
  resolution:   { type: 'string', maxLength: 2000 },
};

const ASSUMPTION_SCHEMA = {
  assumption_id:       { type: 'string', maxLength: 128 },
  action_id:           { type: 'string', required: true, maxLength: 128 },
  assumption:          { type: 'string', required: true, maxLength: 2000 },
  basis:               { type: 'string', maxLength: 2000 },
  validated:           { type: 'boolean' },
  invalidated:         { type: 'boolean' },
  invalidated_reason:  { type: 'string', maxLength: 2000 },
};

function validateField(key, value, rule) {
  if (value === undefined || value === null) {
    if (rule.required) return `${key} is required`;
    return null;
  }

  switch (rule.type) {
    case 'string':
      if (typeof value !== 'string') return `${key} must be a string`;
      if (value.length === 0 && rule.required) return `${key} cannot be empty`;
      if (rule.maxLength && value.length > rule.maxLength) return `${key} exceeds max length of ${rule.maxLength}`;
      if (rule.enum && !rule.enum.includes(value)) return `${key} must be one of: ${rule.enum.join(', ')}`;
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return `${key} must be an integer`;
      if (rule.min !== undefined && value < rule.min) return `${key} must be >= ${rule.min}`;
      if (rule.max !== undefined && value > rule.max) return `${key} must be <= ${rule.max}`;
      break;
    case 'number':
      if (typeof value !== 'number') return `${key} must be a number`;
      if (rule.min !== undefined && value < rule.min) return `${key} must be >= ${rule.min}`;
      if (rule.max !== undefined && value > rule.max) return `${key} must be <= ${rule.max}`;
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return `${key} must be a boolean`;
      break;
    case 'array':
      if (!Array.isArray(value)) return `${key} must be an array`;
      if (rule.maxItems && value.length > rule.maxItems) return `${key} exceeds max items of ${rule.maxItems}`;
      // SECURITY: Validate individual array items are strings with bounded length
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'string') return `${key}[${i}] must be a string`;
        if (value[i].length > 500) return `${key}[${i}] exceeds max length of 500`;
      }
      break;
    case 'object':
      // A free-form JSON object (e.g. a non_fabrication source-of-truth). Arrays
      // and null are not objects for this purpose.
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${key} must be an object`;
      break;
  }
  return null;
}

function validate(body, schema) {
  const errors = [];
  const data = {};

  // A malformed request body can be `null` or a non-object: request.json()
  // returns the value null for the literal body `null` without throwing. Coerce
  // to an empty object so required-field checks produce a 400, not a TypeError
  // that surfaces as a generic 500.
  const src = (body && typeof body === 'object') ? body : {};

  for (const [key, rule] of Object.entries(schema)) {
    // Support both snake_case (schema key) and camelCase (DX preference).
    // Fall back to the camelCase variant when the snake_case key is absent OR
    // explicitly null, so a present camelCase value is not silently dropped by
    // an explicit snake_case null (e.g. { risk_score: null, riskScore: 80 }).
    const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
    const value = (src[key] !== undefined && src[key] !== null) ? src[key] : src[camelKey];

    const error = validateField(key, value, rule);
    if (error) {
      errors.push(error);
    } else if (value !== undefined && value !== null) {
      data[key] = value;
    }
  }

  return {
    valid: errors.length === 0,
    data,
    errors
  };
}

export function validateActionRecord(body) {
  return validate(body, ACTION_RECORD_SCHEMA);
}

export function validateActionOutcome(body) {
  const outcomeSchema = {};
  for (const key of OUTCOME_FIELDS) {
    if (ACTION_RECORD_SCHEMA[key]) {
      outcomeSchema[key] = { ...ACTION_RECORD_SCHEMA[key], required: false };
    }
  }
  const result = validate(body, outcomeSchema);

  // Filter to only outcome fields
  const filtered = {};
  for (const key of OUTCOME_FIELDS) {
    if (result.data[key] !== undefined) filtered[key] = result.data[key];
  }
  result.data = filtered;

  // Must have at least one field
  if (result.valid && Object.keys(filtered).length === 0) {
    result.valid = false;
    result.errors.push('At least one outcome field is required: ' + OUTCOME_FIELDS.join(', '));
  }

  return result;
}

export function validateOpenLoop(body) {
  return validate(body, OPEN_LOOP_SCHEMA);
}

export function validateAssumption(body) {
  return validate(body, ASSUMPTION_SCHEMA);
}

const ASSUMPTION_UPDATE_SCHEMA = {
  validated:           { type: 'boolean', required: true },
  invalidated_reason:  { type: 'string', maxLength: 2000 },
};

export function validateAssumptionUpdate(body) {
  const result = validate(body, ASSUMPTION_UPDATE_SCHEMA);

  // Invalidating requires a reason
  if (result.valid && result.data.validated === false) {
    if (!result.data.invalidated_reason || result.data.invalidated_reason.trim().length === 0) {
      result.valid = false;
      result.errors.push('invalidated_reason is required when invalidating an assumption');
    }
  }

  return result;
}

// ── Guard & Policy validation ──

const GUARD_INPUT_SCHEMA = {
  action_type:     { type: 'string', required: true, maxLength: 128 },
  action:          { type: 'string', alias: 'action_type' }, // Alias for action_type
  risk_score:      { type: 'integer', min: 0, max: 100 },
  agent_id:        { type: 'string', maxLength: 128 },
  agent_name:      { type: 'string', maxLength: 256 },
  systems_touched: { type: 'array', maxItems: 50 },
  reversible:      { type: 'boolean' },
  declared_goal:   { type: 'string', maxLength: 2000 },
  intent:          { type: 'string', alias: 'declared_goal' }, // Alias for declared_goal
  // Phase 2c (issue #121): the resource an action-binding claim commits to.
  // Optional and only meaningful when DASHCLAW_ACT_BINDING is enabled and the
  // token carries a `urn:dashclaw:act-binding` claim. Part of the canonical
  // (action, target, goal) hash tuple.
  target:          { type: 'string', maxLength: 1024 },
  // Non-fabrication integrity (optional). The outbound content to verify and the
  // source-of-truth it must trace to, read by a non_fabrication guard policy.
  content:         { type: 'string', maxLength: 50000 },
  source_of_truth: { type: 'object' },
};

const POLICY_TYPES = ['risk_threshold', 'require_approval', 'block_action_type', 'rate_limit', 'webhook_check', 'behavioral_anomaly', 'semantic_check', 'permission_escalation', 'green_contract', 'branch_freshness', 'non_fabrication'];
const GUARD_ACTIONS = ['allow', 'warn', 'block', 'require_approval'];

const POLICY_SCHEMA = {
  name:        { type: 'string', required: true, maxLength: 256 },
  policy_type: { type: 'string', required: true, enum: POLICY_TYPES },
  rules:       { type: 'string', required: true, maxLength: 4000 },
  active:      { type: 'integer', min: 0, max: 1 },
  agent_ids:   { type: 'string', maxLength: 4000 },
};

export function validateGuardInput(body) {
  // A null / non-object body must not crash here before validate() runs; coerce
  // it so the missing-required-field path returns a 400 rather than a 500.
  const safeBody = (body && typeof body === 'object') ? body : {};
  // Normalize aliases before validation
  const normalized = { ...safeBody };
  if (safeBody.action && !safeBody.action_type) normalized.action_type = safeBody.action;
  if (safeBody.intent && !safeBody.declared_goal) normalized.declared_goal = safeBody.intent;

  return validate(normalized, GUARD_INPUT_SCHEMA);
}

export function validatePolicy(body) {
  const result = validate(body, POLICY_SCHEMA);
  if (!result.valid) return result;

  // Validate rules JSON structure
  let rules;
  try {
    rules = JSON.parse(result.data.rules);
  } catch {
    result.valid = false;
    result.errors.push('rules must be valid JSON');
    return result;
  }

  if (rules.action && !GUARD_ACTIONS.includes(rules.action)) {
    result.valid = false;
    result.errors.push(`rules.action must be one of: ${GUARD_ACTIONS.join(', ')}`);
    return result;
  }

  switch (result.data.policy_type) {
    case 'behavioral_anomaly':
      if (typeof rules.similarity_threshold !== 'number' || rules.similarity_threshold < 0 || rules.similarity_threshold > 1) {
        result.valid = false;
        result.errors.push('behavioral_anomaly policy requires rules.similarity_threshold (0.0-1.0)');
      }
      break;
    case 'semantic_check':
      if (typeof rules.instruction !== 'string' || rules.instruction.length === 0) {
        result.valid = false;
        result.errors.push('semantic_check policy requires rules.instruction string');
      }
      break;
    case 'risk_threshold':
      if (typeof rules.threshold !== 'number' || rules.threshold < 0 || rules.threshold > 100) {
        result.valid = false;
        result.errors.push('risk_threshold policy requires rules.threshold (0-100)');
      }
      break;
    case 'require_approval':
    case 'block_action_type':
      if (!Array.isArray(rules.action_types) || rules.action_types.length === 0) {
        result.valid = false;
        result.errors.push(`${result.data.policy_type} policy requires rules.action_types array`);
      }
      break;
    case 'rate_limit':
      if (typeof rules.max_actions !== 'number' || rules.max_actions <= 0) {
        result.valid = false;
        result.errors.push('rate_limit policy requires rules.max_actions > 0');
      }
      if (typeof rules.window_minutes !== 'number' || rules.window_minutes <= 0) {
        result.valid = false;
        result.errors.push('rate_limit policy requires rules.window_minutes > 0');
      }
      break;
    case 'webhook_check':
      if (typeof rules.url !== 'string') {
        result.valid = false;
        result.errors.push('webhook_check policy requires rules.url as a string');
      } else {
        const urlErr = isValidWebhookUrl(rules.url);
        if (urlErr) {
          result.valid = false;
          result.errors.push(urlErr);
        }
      }
      if (rules.timeout_ms !== undefined) {
        if (typeof rules.timeout_ms !== 'number' || rules.timeout_ms < 1000 || rules.timeout_ms > 10000) {
          result.valid = false;
          result.errors.push('webhook_check rules.timeout_ms must be 1000-10000');
        }
      }
      if (rules.on_timeout !== undefined) {
        if (!['allow', 'block'].includes(rules.on_timeout)) {
          result.valid = false;
          result.errors.push('webhook_check rules.on_timeout must be "allow" or "block"');
        }
      }
      break;
    case 'non_fabrication':
      // All fields optional (sensible defaults applied at evaluation time:
      // applies to all action types, content_path='content',
      // source_path='source_of_truth', on_violation='block').
      if (rules.action_types !== undefined && !Array.isArray(rules.action_types)) {
        result.valid = false;
        result.errors.push('non_fabrication policy rules.action_types must be an array when present');
      }
      if (rules.on_violation !== undefined && !['block', 'require_approval'].includes(rules.on_violation)) {
        result.valid = false;
        result.errors.push('non_fabrication policy rules.on_violation must be "block" or "require_approval"');
      }
      if (rules.content_path !== undefined && typeof rules.content_path !== 'string') {
        result.valid = false;
        result.errors.push('non_fabrication policy rules.content_path must be a string');
      }
      if (rules.source_path !== undefined && typeof rules.source_path !== 'string') {
        result.valid = false;
        result.errors.push('non_fabrication policy rules.source_path must be a string');
      }
      break;
  }

  return result;
}

// Extract the embedded IPv4 from an IPv4-mapped IPv6 address in either the
// dotted form (::ffff:192.168.1.1) or the canonical hex form (::ffff:c0a8:101).
// Node's WHATWG URL parser canonicalizes to hex, so the dotted regex alone
// is not enough to catch an attacker wrapping a private RFC1918 address.
function extractIPv4FromMappedV6(host) {
  const dotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (dotted) return dotted[1];
  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    if (high > 0xffff || low > 0xffff) return null;
    return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
  }
  return null;
}

const IPV4_PRIVATE_PATTERNS = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
];

/**
 * SECURITY: Centralized SSRF protection for webhooks.
 * Returns null if valid, or a string error message if invalid.
 */
export function isValidWebhookUrl(url) {
  if (!url || typeof url !== 'string') return 'URL is required';
  if (!url.startsWith('https://')) return 'URL must use HTTPS';

  try {
    const parsed = new URL(url);
    // SECURITY: Node's URL normalizes IPv6 addresses with surrounding brackets in hostname
    // (e.g. "[fc00::1]"). Strip brackets before pattern matching so all IPv6 regexes
    // work consistently against the bare address string.
    const rawHost = parsed.hostname.toLowerCase();
    const host = rawHost.startsWith('[') && rawHost.endsWith(']')
      ? rawHost.slice(1, -1)
      : rawHost;

    // Block localhost, private IPs, and zero-host variants
    const blockedPatterns = [
      /^localhost$/i,
      /^0\./,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2\d|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^::1$/,                           // IPv6 loopback shorthand
      /^0:0:0:0:0:0:0:0$/,              // IPv6 all-zeros (full notation)
      /^::$/,                            // IPv6 all-zeros (compressed)
      /^(fc|fd)[0-9a-f]{2}:/i,          // fc00::/7 (unique local IPv6)
      /^fe[89ab][0-9a-f]:/i,            // fe80::/10 (link-local IPv6)
      // IPv4-mapped IPv6 (::ffff:x.x.x.x). Cover every private range, not
      // just loopback — without these, an attacker reaches RFC1918 hosts by
      // wrapping the address (e.g. https://[::ffff:192.168.1.1]/admin).
      /^::ffff:0\./i,                    // 0.0.0.0/8 ("this network")
      /^::ffff:10\./i,                   // 10.0.0.0/8 (private)
      /^::ffff:127\./i,                  // 127.0.0.0/8 (loopback)
      /^::ffff:169\.254\./i,             // 169.254.0.0/16 (link-local)
      /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./i, // 172.16.0.0/12 (private)
      /^::ffff:192\.168\./i,             // 192.168.0.0/16 (private)
      /^::ffff:7f[0-9a-f]{2}:/i,        // IPv4-mapped loopback (hex, e.g. 7f00:1 = 127.0.1)
      /^::ffff:0:127\./i,                // IPv4-translated loopback
      /^0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0*1$/i,  // Full notation ::1
      /\.local$/i,
      /\.internal$/i,
      /\.test$/i,
      /\.invalid$/i,
      /\.onion$/i,
    ];

    if (!host || blockedPatterns.some(p => p.test(host))) {
      return 'URL cannot point to localhost, private networks, or invalid domains';
    }

    // Defeat IPv4-mapped IPv6 (::ffff:c0a8:101 → 192.168.1.1) by extracting
    // the embedded IPv4 and rerunning the private-range check against it.
    // The regex list above catches the dotted form when present; this catches
    // the hex form Node emits after canonicalization.
    const mappedV4 = extractIPv4FromMappedV6(host);
    if (mappedV4 && IPV4_PRIVATE_PATTERNS.some((p) => p.test(mappedV4))) {
      return 'URL cannot point to localhost, private networks, or invalid domains';
    }

    // SECURITY: Optional: Enforce an allowlist of trusted domains if configured in environment
    const allowedDomains = process.env.WEBHOOK_ALLOWED_DOMAINS ? 
      process.env.WEBHOOK_ALLOWED_DOMAINS.split(',').map(d => d.trim().toLowerCase()) : 
      [];
    
    if (allowedDomains.length > 0 && !allowedDomains.includes(host)) {
      // Check if host ends with any of the allowed domains (to allow subdomains)
      const isSubdomain = allowedDomains.some(domain => host.endsWith('.' + domain));
      if (!isSubdomain) {
        return 'URL domain is not on the trusted allowlist';
      }
    }

    return null;
  } catch {
    return 'Invalid URL format';
  }
}

/**
 * SECURITY: Enforce max length on string fields to prevent storage abuse.
 * Returns { ok: true, truncated } or { ok: false, error }.
 * Truncates instead of rejecting — use validateRequiredLength for hard limits.
 */
const DEFAULT_MAX_LENGTH = 5000;

export function enforceFieldLimits(body, limits = {}) {
  const errors = [];
  for (const [field, maxLen] of Object.entries(limits)) {
    if (body[field] != null && typeof body[field] === 'string' && body[field].length > maxLen) {
      errors.push(`${field} exceeds max length of ${maxLen}`);
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export { ACTION_TYPES, ACTION_STATUSES, LOOP_TYPES, LOOP_STATUSES, LOOP_PRIORITIES, OUTCOME_FIELDS, POLICY_TYPES, DEFAULT_MAX_LENGTH };
