/**
 * guard.repository.js list projection — verifies the decisions ledger
 * (GET /api/guard) returns the full agent-identity axis set, including the
 * Phase 2c action-binding columns (issue #121). Without act_status in the
 * projection, a documented capability would be invisible via the API.
 */
import { describe, expect, it, vi } from 'vitest';
import { listGuardDecisions } from '@/lib/repositories/guard.repository.js';

describe('guard.repository listGuardDecisions projection', () => {
  it('selects act_status + act_hash alongside the other identity axes', async () => {
    const queries = [];
    const sql = {
      query: vi.fn(async (text) => {
        queries.push(text);
        if (text.includes('information_schema')) return [{ column_name: 'reasons' }];
        if (text.includes('COUNT(*)')) return [{ total: '1' }];
        return [{
          id: 'gd_1',
          decision: 'block',
          verification_status: 'verified',
          replay_status: 'unique',
          act_status: 'mismatch',
          act_hash: 'sha256:abc',
        }];
      }),
    };

    const result = await listGuardDecisions(sql, 'org_1', { limit: 10 });

    const projection = queries.join('\n');
    // All three identity axes travel on the decisions ledger row.
    expect(projection).toContain('verification_status');
    expect(projection).toContain('replay_status');
    expect(projection).toContain('act_status');
    expect(projection).toContain('act_hash');
    // And the values flow through to the caller.
    expect(result.decisions[0].act_status).toBe('mismatch');
    expect(result.decisions[0].act_hash).toBe('sha256:abc');
  });
});
