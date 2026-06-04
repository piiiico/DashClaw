import { describe, expect, it } from 'vitest';
import {
  decayWeight,
  bayesianAverage,
  PRIORS,
  computeVector,
  hashVector,
  buildReputationReceipt,
  verifyReputationReceipt,
} from '../../app/lib/reputation.js';
import { generateSigningKey, publicJwkFromPrivate } from '../../app/lib/integrity/keys.js';

const NOW = '2026-06-04T00:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const iso = (msAgo) => new Date(NOW_MS - msAgo).toISOString();
const DAY = 86_400_000;

describe('reputation math (B2)', () => {
  it('decay weight is 0.5 at the half-life and 1.0 for now/future', () => {
    expect(decayWeight(NOW_MS - 90 * DAY, NOW_MS)).toBeCloseTo(0.5, 6);
    expect(decayWeight(NOW_MS - 180 * DAY, NOW_MS)).toBeCloseTo(0.25, 6);
    expect(decayWeight(NOW_MS, NOW_MS)).toBe(1);
    expect(decayWeight(NOW_MS + 5 * DAY, NOW_MS)).toBe(1); // future clamps to 1
  });

  it('bayesian average with zero samples equals the prior value', () => {
    expect(bayesianAverage(PRIORS.reliability, [])).toBeCloseTo(0.5, 10);
    expect(bayesianAverage(PRIORS.completion, [])).toBeCloseTo(0.7, 10);
  });

  it('computeVector returns priors when there are no events', () => {
    const v = computeVector('agent_1', [], { now: NOW });
    expect(v.agent_id).toBe('agent_1');
    expect(v.reliability_score).toBe(0.5);
    expect(v.completion_rate).toBe(0.7);
    expect(v.policy_violation_rate).toBe(0.05);
    expect(v.approval_adherence).toBe(0.8);
    expect(v.quality_score).toBe(0.7);
    expect(v.risk_score).toBe(0);
    expect(v.total_events).toBe(0);
    expect(v.volume_weight).toBe(0);
    expect(v.confidence).toBe(0);
    expect(v.last_event_at).toBeNull();
    expect(v.computed_at).toBe(NOW);
  });

  it('completion rate rises with successful outcomes and volume/confidence are monotonic', () => {
    const few = computeVector('a', [
      { event_type: 'outcome', value: 1, occurred_at: iso(0) },
      { event_type: 'outcome', value: 1, occurred_at: iso(DAY) },
    ], { now: NOW });
    const many = computeVector('a', Array.from({ length: 20 }, (_, i) => ({
      event_type: 'outcome', value: 1, occurred_at: iso(i * DAY),
    })), { now: NOW });

    expect(many.completion_rate).toBeGreaterThan(few.completion_rate);
    expect(many.volume_weight).toBeGreaterThan(few.volume_weight);
    expect(many.confidence).toBeGreaterThan(few.confidence);
    expect(many.confidence).toBeLessThan(1); // ceiling never reaches 1
  });

  it('risk_score is a decay-weighted mean of recorded 0-100 risk values (wraps existing risk)', () => {
    const v = computeVector('a', [
      { event_type: 'risk', value: 80, occurred_at: iso(0) },
      { event_type: 'risk', value: 80, occurred_at: iso(DAY) },
    ], { now: NOW });
    expect(v.risk_score).toBe(80);
    expect(Number.isInteger(v.risk_score)).toBe(true);
  });

  it('policy violations lower reliability', () => {
    const clean = computeVector('a', [{ event_type: 'outcome', value: 1, occurred_at: iso(0) }], { now: NOW });
    const dirty = computeVector('a', [
      { event_type: 'outcome', value: 1, occurred_at: iso(0) },
      { event_type: 'policy_violation', value: 1, occurred_at: iso(0) },
      { event_type: 'policy_violation', value: 1, occurred_at: iso(0) },
    ], { now: NOW });
    expect(dirty.reliability_score).toBeLessThan(clean.reliability_score);
    expect(dirty.policy_violation_rate).toBeGreaterThan(clean.policy_violation_rate);
  });

  it('hashVector is deterministic for equal vectors', () => {
    const v1 = computeVector('a', [{ event_type: 'outcome', value: 1, occurred_at: iso(0) }], { now: NOW });
    const v2 = computeVector('a', [{ event_type: 'outcome', value: 1, occurred_at: iso(0) }], { now: NOW });
    expect(hashVector(v1)).toBe(hashVector(v2));
    expect(hashVector(v1)).toMatch(/^sha256:/);
  });

  it('signs a receipt and verifies it; a tampered vector fails verification', () => {
    const key = generateSigningKey();
    const pub = key.publicKeyJwk;
    const vector = computeVector('a', [{ event_type: 'outcome', value: 1, occurred_at: iso(0) }], { now: NOW });
    const receipt = buildReputationReceipt(vector, { kid: key.kid, privateKeyJwk: key.privateKeyJwk }, NOW);

    expect(verifyReputationReceipt(receipt, pub)).toEqual({ ok: true });

    const tampered = { ...receipt, vector: { ...receipt.vector, reliability_score: 0.99 } };
    const result = verifyReputationReceipt(tampered, pub);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('vector_hash_mismatch');

    // A wrong key fails the signature check (hash still matches).
    const otherPub = publicJwkFromPrivate(generateSigningKey().privateKeyJwk);
    expect(verifyReputationReceipt(receipt, otherPub).ok).toBe(false);
  });
});
