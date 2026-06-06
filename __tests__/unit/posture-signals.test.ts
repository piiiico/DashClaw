import { describe, it, expect } from 'vitest';
import { buildUnits } from '../../app/lib/posture/signals';
import type { GovernableUnit } from '../../app/lib/posture/types';

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
