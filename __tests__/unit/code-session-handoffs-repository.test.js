import { describe, it, expect } from 'vitest';
import {
  createHandoff,
  getLatestHandoff,
  getHandoffById,
  consumeHandoff,
} from '../../app/lib/repositories/code-session-handoffs.repository.js';

function makeSqlMock(rows) {
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(rows);
  };
  sql.calls = calls;
  return sql;
}

describe('code-session-handoffs.repository', () => {
  describe('createHandoff', () => {
    it('inserts with hf_-prefixed id and returns it', async () => {
      const sql = makeSqlMock([{ id: 'hf_abc123' }]);
      const result = await createHandoff(sql, 'org_1', {
        agentId: 'hermes',
        projectId: 'cp_1',
        createdInSessionId: 'cs_99',
        bundle: { summary: 'wrap-up' },
      });
      expect(result.id).toMatch(/^hf_/);
      expect(sql.calls[0].text).toMatch(/INSERT INTO code_session_handoffs/i);
    });

    it('throws if agentId missing', async () => {
      const sql = makeSqlMock([]);
      await expect(createHandoff(sql, 'org_1', { bundle: {} })).rejects.toThrow(/agentId/);
    });

    it('throws if bundle missing', async () => {
      const sql = makeSqlMock([]);
      await expect(createHandoff(sql, 'org_1', { agentId: 'hermes' })).rejects.toThrow(/bundle/);
    });
  });

  describe('getLatestHandoff', () => {
    it('returns the most recent unconsumed handoff for an agent', async () => {
      const sql = makeSqlMock([{ id: 'hf_1', bundle_json: { summary: 's' }, created_at: '2026-05-14T00:00:00Z' }]);
      const result = await getLatestHandoff(sql, 'org_1', { agentId: 'hermes', projectId: 'cp_1' });
      expect(result.id).toBe('hf_1');
      const text = sql.calls[0].text;
      expect(text).toMatch(/consumed_at IS NULL/i);
      expect(text).toMatch(/ORDER BY created_at DESC/i);
    });

    it('returns null when no handoff exists', async () => {
      const sql = makeSqlMock([]);
      const result = await getLatestHandoff(sql, 'org_1', { agentId: 'hermes' });
      expect(result).toBeNull();
    });

    it('passes project_id through when provided', async () => {
      const sql = makeSqlMock([{ id: 'hf_1' }]);
      await getLatestHandoff(sql, 'org_1', { agentId: 'hermes', projectId: 'cp_42' });
      expect(sql.calls[0].values).toContain('cp_42');
    });
  });

  describe('getHandoffById', () => {
    it('returns the handoff row by id', async () => {
      const sql = makeSqlMock([{ id: 'hf_1', bundle_json: {} }]);
      const result = await getHandoffById(sql, 'org_1', 'hf_1');
      expect(result.id).toBe('hf_1');
    });

    it('returns null when not found', async () => {
      const sql = makeSqlMock([]);
      const result = await getHandoffById(sql, 'org_1', 'hf_missing');
      expect(result).toBeNull();
    });
  });

  describe('consumeHandoff', () => {
    it('sets consumed_at + consumed_by_session_id when null', async () => {
      const sql = makeSqlMock([{ id: 'hf_1', consumed_at: '2026-05-14T00:00:00Z' }]);
      const result = await consumeHandoff(sql, 'org_1', 'hf_1', 'cs_100');
      expect(result.consumed_at).toBeTruthy();
      expect(sql.calls[0].text).toMatch(/consumed_at IS NULL/i);
    });

    it('is idempotent — returns existing row if already consumed', async () => {
      const calls = [];
      const sql = (strings, ...values) => {
        calls.push({ text: strings.join('?'), values });
        if (calls.length === 1) return Promise.resolve([]);
        return Promise.resolve([{ id: 'hf_1', consumed_at: '2026-05-13T00:00:00Z' }]);
      };
      sql.calls = calls;
      const result = await consumeHandoff(sql, 'org_1', 'hf_1', 'cs_100');
      expect(result.consumed_at).toBeTruthy();
    });
  });
});
