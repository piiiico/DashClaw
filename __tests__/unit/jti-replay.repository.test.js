/**
 * Phase 2b (issue #120, design by @piiiico) — jti replay repository tests.
 *
 * Uses an in-memory mock for the Neon tagged-template SQL client. The
 * mock implements the contract checkAndRecord depends on:
 *
 *   - The first INSERT for a (issuer, jti) pair returns [{ jti }]
 *   - Subsequent INSERTs for the same pair return []
 *
 * That mirrors Postgres ON CONFLICT DO NOTHING RETURNING behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkAndRecord,
  sweep,
  _resetCacheForTesting,
} from '../../app/lib/repositories/jti-replay.repository.js';

function makeSqlMock() {
  // Tagged-template SQL: invocation looks like `sql\`...\`` which calls
  // the function with (strings, ...values). We don't care about the
  // exact SQL — we route by `strings[0]` keyword matching and respond
  // appropriately. Behavior is record/dedupe per (issuer, jti).
  const seen = new Map();
  function key(issuer, jti) { return `${issuer}::${jti}`; }
  const sql = vi.fn((strings, ...values) => {
    const text = strings.join(' ');
    if (text.includes('CREATE TABLE')) return Promise.resolve([]);
    if (text.includes('CREATE INDEX')) return Promise.resolve([]);
    // Order matters: INSERT also contains 'jwt_replay_log', so check INSERT first.
    if (text.includes('INSERT INTO jwt_replay_log')) {
      const [issuer, jti, expiresAt, seenAt, agentId] = values;
      const k = key(issuer, jti);
      if (seen.has(k)) {
        return Promise.resolve([]); // ON CONFLICT DO NOTHING
      }
      seen.set(k, { expiresAt, seenAt, agentId });
      return Promise.resolve([{ jti }]);
    }
    if (text.includes('DELETE FROM jwt_replay_log')) {
      const [now] = values;
      const deleted = [];
      for (const [k, v] of seen.entries()) {
        if (v.expiresAt < now) {
          deleted.push({ jti: k.split('::')[1] });
          seen.delete(k);
        }
      }
      return Promise.resolve(deleted);
    }
    return Promise.resolve([]);
  });
  sql._seen = seen;
  return sql;
}

describe('jti-replay repository (Phase 2b)', () => {
  let sql;

  beforeEach(() => {
    _resetCacheForTesting();
    sql = makeSqlMock();
  });

  describe('checkAndRecord', () => {
    it('returns "unique" on first sight of a (issuer, jti) pair', async () => {
      const result = await checkAndRecord(sql, {
        jti: 'jti-1',
        issuer: 'https://idp.example.com',
        expiresAt: 9999999999,
        agentId: 'agent_a',
      });
      expect(result).toBe('unique');
    });

    it('returns "replayed" on second sight of the same (issuer, jti)', async () => {
      const opts = {
        jti: 'jti-2',
        issuer: 'https://idp.example.com',
        expiresAt: 9999999999,
        agentId: 'agent_a',
      };
      const first = await checkAndRecord(sql, opts);
      const second = await checkAndRecord(sql, opts);
      expect(first).toBe('unique');
      expect(second).toBe('replayed');
    });

    it('treats the same jti from different issuers as unique each', async () => {
      const r1 = await checkAndRecord(sql, {
        jti: 'shared-jti',
        issuer: 'https://idp-1.example.com',
        expiresAt: 9999999999,
      });
      const r2 = await checkAndRecord(sql, {
        jti: 'shared-jti',
        issuer: 'https://idp-2.example.com',
        expiresAt: 9999999999,
      });
      expect(r1).toBe('unique');
      expect(r2).toBe('unique');
    });

    it('returns "unavailable" when the DB throws', async () => {
      const failingSql = vi.fn(() => Promise.reject(new Error('connection refused')));
      const result = await checkAndRecord(failingSql, {
        jti: 'jti-3',
        issuer: 'https://idp.example.com',
        expiresAt: 9999999999,
      });
      expect(result).toBe('unavailable');
    });

    it('throws INVALID_INPUT when jti is missing', async () => {
      await expect(
        checkAndRecord(sql, { jti: '', issuer: 'x', expiresAt: 1 }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });

    it('throws INVALID_INPUT when expiresAt is not a number', async () => {
      await expect(
        checkAndRecord(sql, { jti: 'a', issuer: 'x', expiresAt: 'tomorrow' }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });
  });

  describe('sweep', () => {
    let randomSpy;

    beforeEach(() => {
      // Stub Math.random so the 1% probabilistic in-line sweep inside
      // checkAndRecord never fires during these tests. Without this, any
      // run that happens to roll < 0.01 deletes the expired rows mid-setup
      // and the explicit sweep then has nothing to find — flaky.
      randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    });

    afterEach(() => {
      randomSpy.mockRestore();
    });

    it('deletes only rows with expires_at < now', async () => {
      const now = Math.floor(Date.now() / 1000);
      // Two expired, one fresh
      await checkAndRecord(sql, { jti: 'old-1', issuer: 'iss', expiresAt: now - 100 });
      await checkAndRecord(sql, { jti: 'old-2', issuer: 'iss', expiresAt: now - 50 });
      await checkAndRecord(sql, { jti: 'fresh', issuer: 'iss', expiresAt: now + 3600 });

      const deleted = await sweep(sql);

      expect(deleted).toBe(2);
      // fresh row remains — a second checkAndRecord with the same key
      // should return 'replayed'.
      const replay = await checkAndRecord(sql, { jti: 'fresh', issuer: 'iss', expiresAt: now + 3600 });
      expect(replay).toBe('replayed');
    });

    it('returns 0 when no rows are expired', async () => {
      const now = Math.floor(Date.now() / 1000);
      await checkAndRecord(sql, { jti: 'a', issuer: 'i', expiresAt: now + 1000 });
      const deleted = await sweep(sql);
      expect(deleted).toBe(0);
    });
  });

  describe('checkAndRecord — oversized jti', () => {
    it('throws OVERSIZED_JTI when jti exceeds 1024 chars', async () => {
      const longJti = 'a'.repeat(1025);
      await expect(
        checkAndRecord(sql, { jti: longJti, issuer: 'iss', expiresAt: 9999999999 }),
      ).rejects.toMatchObject({ code: 'OVERSIZED_JTI' });
    });

    it('accepts jti exactly at the 1024-char limit', async () => {
      const okJti = 'a'.repeat(1024);
      const result = await checkAndRecord(sql, {
        jti: okJti,
        issuer: 'iss',
        expiresAt: 9999999999,
      });
      expect(result).toBe('unique');
    });
  });
});
