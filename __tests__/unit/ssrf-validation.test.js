/**
 * Security regression tests for IPv6 SSRF blocking and array item validation (SEC-03).
 * Verifies that isValidWebhookUrl blocks IPv6 loopback, private ranges, IPv4-mapped
 * addresses, and that validateActionRecord rejects oversized array items.
 */

import { describe, expect, it } from 'vitest';
import { isValidWebhookUrl, validateActionRecord } from '@/lib/validate.js';

describe('isValidWebhookUrl — SSRF protection regression tests', () => {
  describe('IPv6 loopback addresses (must be blocked)', () => {
    it('blocks https://[::1]/hook (IPv6 loopback shorthand)', () => {
      const result = isValidWebhookUrl('https://[::1]/hook');
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });

    it('blocks https://[0:0:0:0:0:0:0:1]/hook (IPv6 loopback full notation)', () => {
      const result = isValidWebhookUrl('https://[0:0:0:0:0:0:0:1]/hook');
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });
  });

  describe('IPv6 private/unique-local ranges (must be blocked)', () => {
    it('blocks https://[fc00::1]/hook (IPv6 unique local fc00::/7 start)', () => {
      const result = isValidWebhookUrl('https://[fc00::1]/hook');
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });

    it('blocks https://[fd12:3456::1]/hook (IPv6 unique local fd range)', () => {
      const result = isValidWebhookUrl('https://[fd12:3456::1]/hook');
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });

    it('blocks https://[fdff::1]/hook (IPv6 unique local fdff range)', () => {
      const result = isValidWebhookUrl('https://[fdff::1]/hook');
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });
  });

  describe('IPv6 link-local range (must be blocked)', () => {
    it('blocks https://[fe80::1]/hook (IPv6 link-local fe80::/10)', () => {
      const result = isValidWebhookUrl('https://[fe80::1]/hook');
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });

    it('blocks https://[febf::1]/hook (IPv6 link-local febf range)', () => {
      const result = isValidWebhookUrl('https://[febf::1]/hook');
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });
  });

  describe('IPv4-mapped addresses (must be blocked)', () => {
    it('blocks https://[::ffff:127.0.0.1]/hook (IPv4-mapped loopback)', () => {
      const result = isValidWebhookUrl('https://[::ffff:127.0.0.1]/hook');
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });

    it('blocks https://[::ffff:192.168.1.1]/hook (IPv4-mapped private)', () => {
      const result = isValidWebhookUrl('https://[::ffff:192.168.1.1]/hook');
      // IPv4-mapped IPv6 addresses must resolve through the same private-IP
      // check as their bare IPv4 form. Without this, an attacker can target
      // RFC1918 ranges by wrapping them in ::ffff:.
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });
  });

  describe('valid external URLs (must be allowed)', () => {
    it('allows https://hooks.example.com/webhook', () => {
      const result = isValidWebhookUrl('https://hooks.example.com/webhook');
      expect(result).toBeNull();
    });

    it('allows https://api.stripe.com/v1/webhooks', () => {
      const result = isValidWebhookUrl('https://api.stripe.com/v1/webhooks');
      expect(result).toBeNull();
    });

    it('allows https://discord.com/api/webhooks/12345/token', () => {
      const result = isValidWebhookUrl('https://discord.com/api/webhooks/12345/token');
      expect(result).toBeNull();
    });
  });

  describe('invalid URL formats and schemes (must be blocked)', () => {
    it('blocks http:// (non-HTTPS)', () => {
      const result = isValidWebhookUrl('http://hooks.example.com/webhook');
      expect(result).not.toBeNull();
    });

    it('blocks localhost URL', () => {
      const result = isValidWebhookUrl('https://localhost/hook');
      expect(result).not.toBeNull();
    });

    it('blocks 127.x.x.x addresses', () => {
      const result = isValidWebhookUrl('https://127.0.0.1/hook');
      expect(result).not.toBeNull();
    });

    it('returns error string for missing URL', () => {
      const result = isValidWebhookUrl(null);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });

    it('blocks .local TLD', () => {
      const result = isValidWebhookUrl('https://myserver.local/hook');
      expect(result).not.toBeNull();
    });
  });
});

describe('validateActionRecord — array item validation regression tests', () => {
  const baseRecord = {
    agent_id: 'agent_test',
    action_type: 'build',
    declared_goal: 'Run the test suite',
  };

  describe('systems_touched array', () => {
    it('accepts valid array with string items under 500 chars', () => {
      const result = validateActionRecord({
        ...baseRecord,
        systems_touched: ['github', 'ci-pipeline', 'aws-s3'],
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects array items longer than 500 characters', () => {
      const oversizedItem = 'a'.repeat(501);
      const result = validateActionRecord({
        ...baseRecord,
        systems_touched: [oversizedItem],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('exceeds max length of 500'))).toBe(true);
    });

    it('rejects non-string array items (number)', () => {
      const result = validateActionRecord({
        ...baseRecord,
        systems_touched: [123],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must be a string'))).toBe(true);
    });

    it('rejects non-string array items (object)', () => {
      const result = validateActionRecord({
        ...baseRecord,
        systems_touched: [{ nested: 'object' }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must be a string'))).toBe(true);
    });

    it('rejects array item at exactly 501 characters', () => {
      const result = validateActionRecord({
        ...baseRecord,
        systems_touched: ['a'.repeat(501)],
      });
      expect(result.valid).toBe(false);
    });

    it('accepts array item at exactly 500 characters', () => {
      const result = validateActionRecord({
        ...baseRecord,
        systems_touched: ['a'.repeat(500)],
      });
      expect(result.valid).toBe(true);
    });

    it('rejects oversized item in multi-item array and identifies the offending index', () => {
      const result = validateActionRecord({
        ...baseRecord,
        systems_touched: ['github', 'a'.repeat(501)],
      });
      expect(result.valid).toBe(false);
      // Error message should reference the array field and indicate the oversized item
      const errorMsg = result.errors.join(' ');
      expect(errorMsg).toMatch(/systems_touched/);
    });
  });

  describe('artifacts_created array', () => {
    it('rejects non-string items in artifacts_created array', () => {
      const result = validateActionRecord({
        ...baseRecord,
        status: 'completed',
        artifacts_created: [null],
      });
      expect(result.valid).toBe(false);
    });
  });
});
