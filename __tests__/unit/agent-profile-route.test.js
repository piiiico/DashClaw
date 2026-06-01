import { describe, expect, it } from 'vitest';
import { createSqlMock } from '../helpers.js';

describe('getAssumptionsSummary', () => {
  it('returns counts by validation state', async () => {
    const sql = createSqlMock({
      queryResponses: [
        [{ total: '23', validated: '14', invalidated: '3', unverified: '6' }],
      ],
    });

    const { getAssumptionsSummary } = await import(
      '../../app/lib/repositories/assumptions.repository.js'
    );
    const result = await getAssumptionsSummary(sql, 'org_test', 'agent_1');

    expect(result).toEqual({ total: 23, validated: 14, invalidated: 3, unverified: 6 });
  });

  it('returns zeros when no assumptions exist', async () => {
    const sql = createSqlMock({
      queryResponses: [[{}]],
    });

    const { getAssumptionsSummary } = await import(
      '../../app/lib/repositories/assumptions.repository.js'
    );
    const result = await getAssumptionsSummary(sql, 'org_test', 'agent_1');

    expect(result).toEqual({ total: 0, validated: 0, invalidated: 0, unverified: 0 });
  });
});

describe('getAgentTrustPosture', () => {
  it('aggregates trust data from multiple tables', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        // agent_pairings
        [{ permission_level: 'workspace_write', status: 'approved' }],
        // agent_identities
        [{ agent_id: 'agent_1' }],
        // settings
        [{ value: 'true' }],
        // policies
        [
          { id: 1, policy_type: 'require_approval', description: 'High risk', agent_ids: null },
          { id: 2, policy_type: 'rate_limit', description: 'Throttle', agent_ids: '["agent_1"]' },
          { id: 3, policy_type: 'block_action_type', description: 'No deploy', agent_ids: '["agent_2"]' },
        ],
        // action_records counts — consolidated into a single row with FILTER clauses
        [{ approved_count: 8, denied_count: 2, blocks_count: 1 }],
      ],
    });

    const { getAgentTrustPosture } = await import(
      '../../app/lib/repositories/agents.repository.js'
    );
    const result = await getAgentTrustPosture(sql, 'org_test', 'agent_1');

    expect(result.permission_level).toBe('workspace_write');
    expect(result.identity_verified).toBe(true);
    expect(result.signature_enforced).toBe(true);
    expect(result.active_policies_count).toBe(2); // global + agent_1 specific, not agent_2's
    expect(result.policies).toHaveLength(2);
    expect(result.approval_record).toEqual({ total: 10, allowed: 8, denied: 2 });
    expect(result.blocks_30d).toBe(1);
  });

  it("reads the agent's APPROVED pairing, not a never-set 'active' status", async () => {
    // Regression: the pairing lifecycle is pending -> approved -> expired; no row
    // is ever status='active'. Querying 'active' (the old literal) meant the Trust
    // Posture panel always fell back to permission_level 'unknown'. guard.js already
    // filters 'approved' — this asserts the panel query matches the real lifecycle.
    const sql = createSqlMock({
      taggedResponses: [
        [{ permission_level: 'workspace_write', status: 'approved' }],
        [{ agent_id: 'agent_1' }],
        [{ value: 'true' }],
        [],
        [{ approved_count: 0, denied_count: 0, blocks_count: 0 }],
      ],
    });

    const { getAgentTrustPosture } = await import(
      '../../app/lib/repositories/agents.repository.js'
    );
    const result = await getAgentTrustPosture(sql, 'org_test', 'agent_1');

    const pairingQuery = sql.taggedCalls.find((c) => /FROM agent_pairings/.test(c.text));
    expect(pairingQuery, 'expected an agent_pairings lookup').toBeTruthy();
    expect(pairingQuery.text).toMatch(/status = 'approved'/);
    expect(pairingQuery.text).not.toMatch(/status = 'active'/);
    expect(result.permission_level).toBe('workspace_write');
  });

  it('inherits the base parent pairing/identity for a composed sub-agent id', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ permission_level: 'workspace_write', status: 'approved' }], // parent's pairing
        [{ agent_id: 'claude-code' }],                                  // parent's identity
        [{ value: 'true' }],
        [],
        [{ approved_count: 0, denied_count: 0, blocks_count: 0 }],
      ],
    });
    const { getAgentTrustPosture } = await import(
      '../../app/lib/repositories/agents.repository.js'
    );
    const result = await getAgentTrustPosture(sql, 'org_test', 'claude-code:explore');

    const pairingQuery = sql.taggedCalls.find((c) => /FROM agent_pairings/.test(c.text));
    expect(pairingQuery.values).toContain('claude-code:explore');
    expect(pairingQuery.values).toContain('claude-code'); // base parent included for inheritance
    expect(result.permission_level).toBe('workspace_write');
    expect(result.identity_verified).toBe(true);
  });
});
