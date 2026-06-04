/**
 * Agent reputation math (SPEC-mega.md Group B). Deterministic, dependency-free
 * except for DashClaw's existing integrity layer (canonical-json hashing +
 * Ed25519 signing via node:crypto) and the timing-safe comparator. Ported from
 * the Agent-Reputation-Oracle math (decay, Bayesian smoothing, volume,
 * confidence). Collusion and marketplace defenses are intentionally out of
 * scope for the self-sourced v1 (see docs/absorbed-projects.md section 5).
 *
 * No new crypto dependency: hashing is digestJson (canonical-json), signing is
 * the integrity layer's Ed25519 signer, verification is verifyCanonical plus a
 * constant-time compare of the vector hash.
 */

import { digestJson } from './integrity/canonicalize.js';
import { signCanonical, verifyCanonical } from './integrity/sign.js';
import { timingSafeCompare } from './timing-safe.js';

export const HALF_LIFE_DAYS = 90;
const DAY_MS = 86_400_000;

// Pseudo-count Bayesian priors: weight is the prior strength, value the default
// before any data. With zero events a dimension equals its prior value.
export const PRIORS = {
  reliability: { weight: 5, value: 0.5 },
  completion: { weight: 3, value: 0.7 },
  policy_violation: { weight: 5, value: 0.05 },
  approval: { weight: 2, value: 0.8 },
  quality: { weight: 3, value: 0.7 },
};

export const RECEIPT_VERSION = 'dashclaw-reputation/v1';

const EVENT_TYPES = ['outcome', 'policy_violation', 'approval', 'quality', 'risk'];

export function decayWeight(occurredAtMs, nowMs, halfLifeDays = HALF_LIFE_DAYS) {
  const lambda = Math.LN2 / halfLifeDays;
  const deltaDays = (nowMs - occurredAtMs) / DAY_MS;
  if (!Number.isFinite(deltaDays) || deltaDays <= 0) return 1; // future / now clamps to full weight
  return Math.exp(-lambda * deltaDays);
}

export function bayesianAverage(prior, samples) {
  let num = prior.weight * prior.value;
  let den = prior.weight;
  for (const s of samples) {
    num += s.w * s.x;
    den += s.w;
  }
  return den > 0 ? num / den : prior.value;
}

function toMs(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function round4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

function computeRiskScore(riskEvents) {
  if (!riskEvents.length) return 0;
  let num = 0;
  let den = 0;
  for (const e of riskEvents) { num += e.dw * e.value; den += e.dw; }
  if (den === 0) return 0;
  return Math.max(0, Math.min(100, Math.round(num / den)));
}

/**
 * Compute the reputation vector from a flat list of events.
 * Each event: { event_type, value, occurred_at (ISO|ms|Date), weight? }.
 * value is in [0,1] for the Bayesian dimensions; for 'risk' it is 0-100.
 */
export function computeVector(agentId, events, opts = {}) {
  const nowMs = opts.nowMs != null ? opts.nowMs : (opts.now ? Date.parse(opts.now) : Date.now());
  const nowIso = opts.now || new Date(nowMs).toISOString();

  const byType = { outcome: [], policy_violation: [], approval: [], quality: [], risk: [] };
  let lastEventMs = null;
  const allWeights = [];
  let counted = 0;

  for (const ev of events || []) {
    if (!ev || !EVENT_TYPES.includes(ev.event_type)) continue;
    const ms = toMs(ev.occurred_at);
    if (ms == null) continue;
    const dw = decayWeight(ms, nowMs) * (Number.isFinite(ev.weight) ? ev.weight : 1);
    byType[ev.event_type].push({ dw, value: Number(ev.value) || 0, ms });
    allWeights.push(dw);
    counted += 1;
    if (lastEventMs == null || ms > lastEventMs) lastEventMs = ms;
  }

  const samples = (arr, map = (e) => e.value) => arr.map((e) => ({ w: e.dw, x: map(e) }));

  // Reliability folds outcome success, approval adherence, and the inverse of
  // policy violations into one "behaved well overall" rate; completion is the
  // raw success rate. They share outcome events but differ by prior and inputs.
  const reliabilitySamples = [
    ...samples(byType.outcome),
    ...samples(byType.approval),
    ...samples(byType.policy_violation, (e) => 1 - e.value),
  ];

  const volume_weight = round4(Math.log(1 + allWeights.reduce((a, b) => a + b, 0)));

  return {
    agent_id: agentId,
    reliability_score: round4(bayesianAverage(PRIORS.reliability, reliabilitySamples)),
    completion_rate: round4(bayesianAverage(PRIORS.completion, samples(byType.outcome))),
    policy_violation_rate: round4(bayesianAverage(PRIORS.policy_violation, samples(byType.policy_violation))),
    approval_adherence: round4(bayesianAverage(PRIORS.approval, samples(byType.approval))),
    quality_score: round4(bayesianAverage(PRIORS.quality, samples(byType.quality))),
    risk_score: computeRiskScore(byType.risk),
    volume_weight,
    confidence: round4(1 - Math.exp(-0.1 * volume_weight)),
    total_events: counted,
    last_event_at: lastEventMs != null ? new Date(lastEventMs).toISOString() : null,
    computed_at: nowIso,
  };
}

export function hashVector(vector) {
  return digestJson(vector);
}

/**
 * Build a signed reputation receipt. The signature binds the vector hash,
 * agent, issuer-asserted time, and event count; the receipt also embeds the
 * full vector for the verifier. issuedAt is issuer-asserted, not a trusted
 * timestamp (same caveat as the integrity receipt/bundle envelopes).
 */
export function buildReputationReceipt(vector, key, issuedAt) {
  const base = {
    version: RECEIPT_VERSION,
    issuedAt,
    agentId: vector.agent_id,
    vectorHash: hashVector(vector),
    totalEvents: vector.total_events,
  };
  const signature = signCanonical(base, key);
  return { ...base, vector, signature };
}

/**
 * Verify a reputation receipt: the embedded vector must hash to the signed
 * vectorHash (constant-time compare), and the signature must verify against the
 * public JWK.
 */
export function verifyReputationReceipt(receipt, publicKeyJwk) {
  if (!receipt || typeof receipt !== 'object' || !receipt.signature || !receipt.vector) {
    return { ok: false, reason: 'malformed' };
  }
  const recomputed = hashVector(receipt.vector);
  if (!timingSafeCompare(recomputed, String(receipt.vectorHash || ''))) {
    return { ok: false, reason: 'vector_hash_mismatch' };
  }
  const { vector, signature, ...base } = receipt;
  void vector;
  const ok = verifyCanonical(base, signature, publicKeyJwk);
  return ok ? { ok: true } : { ok: false, reason: 'bad_signature' };
}
