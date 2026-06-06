import { describe, it, expect } from 'vitest';
import { buildUnits, applyFindingStates } from '../../app/lib/posture/signals';
import type { GovernableUnit, PostureFinding } from '../../app/lib/posture/types';

const cap = (over: Partial<GovernableUnit> = {}): GovernableUnit => ({
  key: 'stripe-pay', surfaceType: 'capability', riskLevel: 'high', reversible: false,
  hasSpendExposure: false, requiresApproval: true, observedCount: 0, dimension: 'spend', ...over,
});
const action = (over: Partial<GovernableUnit> = {}): GovernableUnit => ({
  key: 'action_type:deploy', surfaceType: 'action_type', riskLevel: 'medium', reversible: true,
  hasSpendExposure: false, requiresApproval: false, observedCount: 5, dimension: 'enforcement', ...over,
});

describe('buildUnits', () => {
  it('merges capability and action units, keeping both', () => {
    const units = buildUnits([cap()], [action()], new Set());
    expect(units.map((u) => u.key).sort()).toEqual(['action_type:deploy', 'stripe-pay']);
  });

  it('flips hasSpendExposure on a unit whose key matches an active x402 provider slug', () => {
    const units = buildUnits([cap({ key: 'stripe-pay', hasSpendExposure: false })], [], new Set(['stripe-pay']));
    expect(units.find((u) => u.key === 'stripe-pay')!.hasSpendExposure).toBe(true);
  });

  it('leaves spend exposure unchanged when no x402 slug matches', () => {
    const units = buildUnits([cap({ key: 'internal-tool', hasSpendExposure: false })], [], new Set(['some-other-provider']));
    expect(units.find((u) => u.key === 'internal-tool')!.hasSpendExposure).toBe(false);
  });

  it('does not downgrade an already spend-exposed unit', () => {
    const units = buildUnits([cap({ key: 'internal-tool', hasSpendExposure: true })], [], new Set());
    expect(units.find((u) => u.key === 'internal-tool')!.hasSpendExposure).toBe(true);
  });

  it('bumps observedCount when a capability and action share a key', () => {
    const units = buildUnits([cap({ key: 'shared', observedCount: 0 })], [action({ key: 'shared', observedCount: 7 })], new Set());
    expect(units).toHaveLength(1);
    expect(units[0]!.observedCount).toBe(7);
    expect(units[0]!.surfaceType).toBe('capability'); // capability stays authoritative
  });
});

const finding = (over: Partial<PostureFinding> = {}): PostureFinding => ({
  key: 'enforcement:action_type:deploy:create_policy_draft',
  dimension: 'enforcement',
  severity: 'high',
  title: 'Destructive deploy actions reach allow ungoverned',
  evidence: { observedCount: 38, exampleActionIds: ['act_1'] },
  scoreDelta: 5,
  fix: { type: 'create_policy_draft', policyType: 'risk_threshold', rules: {} },
  status: 'open',
  ...over,
});

describe('applyFindingStates', () => {
  it('carries a stored snooze forward so the finding is no longer open', () => {
    const states = new Map([[finding().key, 'snoozed']]);
    const merged = applyFindingStates([finding()], states);
    expect(merged[0]!.status).toBe('snoozed');
  });

  it('leaves findings with no stored state as open (identity when map is empty)', () => {
    const input = [finding()];
    const merged = applyFindingStates(input, new Map());
    expect(merged).toBe(input); // short-circuits — same reference, no copy
    expect(merged[0]!.status).toBe('open');
  });

  it('only restamps the matching key', () => {
    const a = finding({ key: 'a', status: 'open' });
    const b = finding({ key: 'b', status: 'open' });
    const merged = applyFindingStates([a, b], new Map([['a', 'resolved']]));
    expect(merged.find((f) => f.key === 'a')!.status).toBe('resolved');
    expect(merged.find((f) => f.key === 'b')!.status).toBe('open');
  });

  it('ignores an unknown/garbage stored status (fails closed to the derived status)', () => {
    const merged = applyFindingStates([finding()], new Map([[finding().key, 'bogus_status']]));
    expect(merged[0]!.status).toBe('open');
  });
});
