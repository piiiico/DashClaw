import { describe, it, expect } from 'vitest';
import { validateActionRecord, validateGuardInput, validateOpenLoop, isValidWebhookUrl } from '@/lib/validate';

describe('validators tolerate a null or non-object body (no 500 crash)', () => {
  // request.json() returns the value `null` for the literal body `null` without
  // throwing, so a client POSTing `null` must get a 400 (valid:false), not a
  // TypeError that surfaces as a generic 500.
  it('validateActionRecord(null) returns valid:false without throwing', () => {
    const result = validateActionRecord(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('action_type is required');
  });

  it('validateGuardInput(null) returns valid:false without throwing', () => {
    const result = validateGuardInput(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('action_type is required');
  });

  it('validateOpenLoop(null) returns valid:false without throwing', () => {
    expect(() => validateOpenLoop(null)).not.toThrow();
    expect(validateOpenLoop(null).valid).toBe(false);
  });

  it('non-object bodies (undefined, primitive) do not throw', () => {
    expect(() => validateActionRecord(undefined)).not.toThrow();
    expect(() => validateGuardInput('not an object')).not.toThrow();
    expect(validateActionRecord(42).valid).toBe(false);
  });
});

describe('validateActionRecord', () => {
  it('should validate a correct action record', () => {
    const validRecord = {
      agent_id: 'agent-123',
      action_type: 'build',
      declared_goal: 'Build the project',
    };
    const result = validateActionRecord(validRecord);
    expect(result.valid).toBe(true);
    expect(result.data.agent_id).toBe('agent-123');
  });

  it('should fail if required fields are missing', () => {
    const invalidRecord = {
      agent_id: 'agent-123',
      // action_type is missing
    };
    const result = validateActionRecord(invalidRecord);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('action_type is required');
  });

  it('should accept arbitrary action_type strings (agent frameworks send raw tool names)', () => {
    const record = {
      agent_id: 'agent-123',
      action_type: 'read',
      declared_goal: 'Read a file',
    };
    const result = validateActionRecord(record);
    expect(result.valid).toBe(true);
    expect(result.data.action_type).toBe('read');
  });

  it('should allow recommendation metadata fields', () => {
    const validRecord = {
      agent_id: 'agent-123',
      action_type: 'build',
      declared_goal: 'Build the project',
      recommendation_id: 'lrec_123',
      recommendation_applied: false,
      recommendation_override_reason: 'warn_mode_no_autoadapt',
    };
    const result = validateActionRecord(validRecord);
    expect(result.valid).toBe(true);
    expect(result.data.recommendation_id).toBe('lrec_123');
    expect(result.data.recommendation_applied).toBe(false);
  });
});

describe('isValidWebhookUrl', () => {
  it('should allow valid external HTTPS URLs', () => {
    expect(isValidWebhookUrl('https://api.slack.com/webhooks')).toBe(null);
    expect(isValidWebhookUrl('https://discord.com/api/webhooks')).toBe(null);
  });

  it('should block non-HTTPS URLs', () => {
    expect(isValidWebhookUrl('http://api.slack.com')).toBe('URL must use HTTPS');
    expect(isValidWebhookUrl('ftp://server.com')).toBe('URL must use HTTPS');
  });

  it('should block localhost and loopback', () => {
    expect(isValidWebhookUrl('https://localhost')).toContain('cannot point to localhost');
    expect(isValidWebhookUrl('https://127.0.0.1')).toContain('cannot point to localhost');
    expect(isValidWebhookUrl('https://[::1]')).toContain('cannot point to localhost');
  });

  it('should block private networks', () => {
    expect(isValidWebhookUrl('https://10.0.0.1')).toContain('cannot point to localhost');
    expect(isValidWebhookUrl('https://192.168.1.1')).toContain('cannot point to localhost');
    expect(isValidWebhookUrl('https://172.16.0.1')).toContain('cannot point to localhost');
  });

  it('should block invalid/internal domains', () => {
    expect(isValidWebhookUrl('https://server.local')).toContain('invalid domains');
    expect(isValidWebhookUrl('https://api.internal')).toContain('invalid domains');
    expect(isValidWebhookUrl('https://test.onion')).toContain('invalid domains');
  });
});
