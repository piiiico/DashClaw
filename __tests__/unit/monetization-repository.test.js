import { beforeEach, describe, expect, it, vi } from 'vitest';
import { countVerifiedIntegrations } from '../../app/lib/repositories/monetization.repository.js';

/**
 * Build a tagged-template SQL mock that records calls and returns a canned
 * row set. Neon uses tagged templates, so we capture the interpolated
 * strings/values to assert the SQL shape (agent_id pattern, recency, exclusion).
 */
function makeSqlMock(rows) {
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(rows);
  };
  sql.calls = calls;
  return sql;
}

describe('countVerifiedIntegrations', () => {
  it('Case 1: empty result set returns 0', async () => {
    const sql = makeSqlMock([]);
    const n = await countVerifiedIntegrations(sql);
    expect(n).toBe(0);
  });

  it('Case 2: returns the integer COUNT(DISTINCT org_id) from the row', async () => {
    const sql = makeSqlMock([{ count: 3 }]);
    const n = await countVerifiedIntegrations(sql);
    expect(n).toBe(3);
  });

  it('Case 3: SQL matches all three coding-agent agent_id patterns (claude-code%, codex%, hermes%)', async () => {
    const sql = makeSqlMock([{ count: 1 }]);
    await countVerifiedIntegrations(sql);

    expect(sql.calls.length).toBe(1);
    const joined = sql.calls[0].text;
    expect(joined).toMatch(/agent_id\s+ILIKE/i);
    // The literal pattern strings appear in the tagged template (not in
    // interpolated values), so check the raw text for each.
    expect(joined).toMatch(/claude-code%/);
    expect(joined).toMatch(/codex%/);
    expect(joined).toMatch(/hermes%/);
  });

  it('Case 4: SQL counts DISTINCT org_id (aggregate, never per-row)', async () => {
    const sql = makeSqlMock([{ count: 0 }]);
    await countVerifiedIntegrations(sql);
    expect(sql.calls[0].text).toMatch(/COUNT\(DISTINCT\s+org_id\)/i);
  });

  it('Case 5: default exclusion list is [org_default, org_demo]', async () => {
    const sql = makeSqlMock([{ count: 0 }]);
    await countVerifiedIntegrations(sql);

    // The exclusion array is interpolated as a single value — find it.
    const arrayParam = sql.calls[0].values.find(
      (v) => Array.isArray(v) && v.includes('org_default') && v.includes('org_demo'),
    );
    expect(arrayParam).toBeDefined();
    expect(arrayParam).toEqual(['org_default', 'org_demo']);
  });

  it('Case 6: default recency window is 90 days', async () => {
    const sql = makeSqlMock([{ count: 0 }]);
    await countVerifiedIntegrations(sql);

    expect(sql.calls[0].values).toContain(90);
  });

  it('Case 7: accepts custom excludeOrgIds + recencyDays options', async () => {
    const sql = makeSqlMock([{ count: 5 }]);
    await countVerifiedIntegrations(sql, {
      excludeOrgIds: ['org_foo', 'org_bar', 'org_baz'],
      recencyDays: 30,
    });

    const arrayParam = sql.calls[0].values.find((v) => Array.isArray(v));
    expect(arrayParam).toEqual(['org_foo', 'org_bar', 'org_baz']);
    expect(sql.calls[0].values).toContain(30);
  });

  it('Case 8: missing count field in row returns 0 (defensive)', async () => {
    const sql = makeSqlMock([{}]);
    const n = await countVerifiedIntegrations(sql);
    expect(n).toBe(0);
  });
});
