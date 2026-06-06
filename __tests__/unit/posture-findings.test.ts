import { describe, it, expect } from 'vitest';
import { deriveFindings } from '../../app/lib/posture/findings';
import type { GovernableUnit, Adjustments } from '../../app/lib/posture/types';

const unit = (over: Partial<GovernableUnit> = {}): GovernableUnit => ({
  key: 'cap:deploy', surfaceType: 'capability', riskLevel: 'high', reversible: false,
  hasSpendExposure: false, requiresApproval: true, observedCount: 10, dimension: 'enforcement', ...over,
});
const noAdj: Adjustments = { incidents: [], approvalFollowThrough: 1, coachOpenGapUnitKeys: [] };

describe('deriveFindings', () => {
  it('produces no finding for a fully-covered unit', () => {
    expect(deriveFindings([unit({ key: 'a' })], { a: 1 }, noAdj)).toHaveLength(0);
  });

  it('produces a create_policy_draft finding for an uncovered unit, policyType chosen by dimension', () => {
    const f = deriveFindings([unit({ key: 'a', dimension: 'spend' })], { a: 0 }, noAdj);
    expect(f).toHaveLength(1);
    expect(f[0]!.fix.type).toBe('create_policy_draft');
    expect(f[0]!.fix).toMatchObject({ policyType: 'x402_spend_limit' });
    expect(f[0]!.status).toBe('open');
    expect(f[0]!.dimension).toBe('spend');
  });

  it('finding keys are deterministic and stable across runs', () => {
    const a = deriveFindings([unit({ key: 'a' })], { a: 0 }, noAdj);
    const b = deriveFindings([unit({ key: 'a' })], { a: 0 }, noAdj);
    expect(a[0]!.key).toBe(b[0]!.key);
    expect(a[0]!.key).toMatch(/^[0-9a-f]{8}$/);
  });

  it('orders coverage gaps by scoreDelta desc (higher-risk uncovered first)', () => {
    const units = [
      unit({ key: 'minor', riskLevel: 'low', observedCount: 1, dimension: 'enforcement' }),
      unit({ key: 'crit', riskLevel: 'critical', observedCount: 100, dimension: 'enforcement' }),
    ];
    const f = deriveFindings(units, { minor: 0, crit: 0 }, noAdj);
    expect(f).toHaveLength(2);
    expect(f[0]!.title).toContain('"crit"');
    expect(f[0]!.scoreDelta).toBeGreaterThanOrEqual(f[1]!.scoreDelta);
  });

  it('a coach open-gap forces at most partial coverage, yielding a finding even if a policy fires', () => {
    const adj: Adjustments = { incidents: [], approvalFollowThrough: 1, coachOpenGapUnitKeys: ['a'] };
    const f = deriveFindings([unit({ key: 'a' })], { a: 1 }, adj);
    expect(f).toHaveLength(1);
    expect(f[0]!.scoreDelta).toBeGreaterThan(0);
  });

  it('an ungoverned incident becomes a critical review_incident finding sorted above coverage gaps', () => {
    const units = [
      unit({ key: 'x', riskLevel: 'critical', dimension: 'enforcement', observedCount: 50 }),
      unit({ key: 'minor', riskLevel: 'low', dimension: 'spend', observedCount: 1 }),
    ];
    const adj: Adjustments = {
      incidents: [{ unitKey: 'x', actionId: 'act_1', riskLevel: 'high', ts: 't' }],
      approvalFollowThrough: 1, coachOpenGapUnitKeys: [],
    };
    const f = deriveFindings(units, { x: 1, minor: 0 }, adj);
    const incident = f.find((y) => y.fix.type === 'review_incident')!;
    expect(incident.severity).toBe('critical');
    expect(incident.fix).toMatchObject({ type: 'review_incident', actionIds: ['act_1'] });
    expect(incident.scoreDelta).toBeGreaterThan(0); // cap-relief gives it real weight
    expect(f[0]).toBe(incident);
  });
});
