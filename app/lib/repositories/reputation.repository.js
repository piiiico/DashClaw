/**
 * Reputation repository (SPEC-mega.md Group B). All SQL for the reputation
 * tables plus evidence sourcing and the recompute orchestrator. Every query is
 * org-scoped (WHERE org_id = ${orgId}); there is no cross-org access. The
 * vector math and receipt signing live in app/lib/reputation.js.
 */

import crypto from 'node:crypto';
import { computeVector, buildReputationReceipt, hashVector } from '../reputation.js';
import { getServerSigningKey } from '../integrity/server-key.js';

const DEFAULT_LOOKBACK_DAYS = 365;

function genId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

// ---- reputation tables CRUD -------------------------------------------------

export async function listReputationEvents(sql, orgId, agentId, { limit = 50, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  return sql`
    SELECT id, agent_id, source_agent_id, event_type, weight, value, action_id, occurred_at, metadata, created_at
    FROM agent_reputation_events
    WHERE org_id = ${orgId} AND agent_id = ${agentId}
    ORDER BY occurred_at DESC
    LIMIT ${lim} OFFSET ${off}`;
}

export async function getReputationSnapshot(sql, orgId, agentId) {
  const rows = await sql`
    SELECT * FROM agent_reputation_snapshots
    WHERE org_id = ${orgId} AND agent_id = ${agentId}
    LIMIT 1`;
  return rows[0] || null;
}

export async function listReputationSnapshots(sql, orgId, { limit = 20 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return sql`
    SELECT * FROM agent_reputation_snapshots
    WHERE org_id = ${orgId}
    ORDER BY reliability_score DESC NULLS LAST, total_events DESC
    LIMIT ${lim}`;
}

export async function upsertReputationSnapshot(sql, orgId, agentId, vector) {
  const id = genId('ars');
  const vectorHash = hashVector(vector);
  const rows = await sql`
    INSERT INTO agent_reputation_snapshots
      (id, org_id, agent_id, reliability_score, completion_rate, policy_violation_rate, approval_adherence,
       quality_score, risk_score, volume_weight, confidence, total_events, last_event_at, computed_at, vector_hash)
    VALUES
      (${id}, ${orgId}, ${agentId}, ${vector.reliability_score}, ${vector.completion_rate}, ${vector.policy_violation_rate}, ${vector.approval_adherence},
       ${vector.quality_score}, ${vector.risk_score}, ${vector.volume_weight}, ${vector.confidence}, ${vector.total_events}, ${vector.last_event_at}, ${vector.computed_at}, ${vectorHash})
    ON CONFLICT (org_id, agent_id) DO UPDATE SET
      reliability_score = EXCLUDED.reliability_score,
      completion_rate = EXCLUDED.completion_rate,
      policy_violation_rate = EXCLUDED.policy_violation_rate,
      approval_adherence = EXCLUDED.approval_adherence,
      quality_score = EXCLUDED.quality_score,
      risk_score = EXCLUDED.risk_score,
      volume_weight = EXCLUDED.volume_weight,
      confidence = EXCLUDED.confidence,
      total_events = EXCLUDED.total_events,
      last_event_at = EXCLUDED.last_event_at,
      computed_at = EXCLUDED.computed_at,
      vector_hash = EXCLUDED.vector_hash
    RETURNING *`;
  return rows[0] || null;
}

export async function insertReputationReceipt(sql, orgId, agentId, { receipt, kid, issuedAt }) {
  const id = genId('arr');
  const rows = await sql`
    INSERT INTO agent_reputation_receipts (id, org_id, agent_id, vector_hash, receipt, kid, issued_at)
    VALUES (${id}, ${orgId}, ${agentId}, ${receipt.vectorHash}, ${JSON.stringify(receipt)}::jsonb, ${kid}, ${issuedAt})
    RETURNING id, org_id, agent_id, vector_hash, kid, issued_at, created_at`;
  return rows[0] || null;
}

export async function getLatestReputationReceipt(sql, orgId, agentId) {
  const rows = await sql`
    SELECT receipt FROM agent_reputation_receipts
    WHERE org_id = ${orgId} AND agent_id = ${agentId}
    ORDER BY created_at DESC
    LIMIT 1`;
  return rows[0]?.receipt || null;
}

// ---- evidence sourcing (B4) -------------------------------------------------

function terminalOutcome(outcomeStatus, status) {
  if (outcomeStatus === 'completed') return 1;
  if (outcomeStatus === 'failed') return 0;
  if (outcomeStatus === 'partial') return 0.5;
  if (outcomeStatus === 'pending' || outcomeStatus == null) {
    if (status === 'completed') return 1;
    if (status === 'failed' || status === 'cancelled' || status === 'blocked') return 0;
  }
  return null; // running / non-terminal -> no outcome event
}

/**
 * Derive reputation events for an agent from the straightforward evidence:
 * action_records (outcome, risk, approval), guard_decisions (policy violations),
 * eval_scores + feedback (quality). Architected so drift / learning / scoring
 * sources can be added behind the same interface later. Each event carries a
 * deterministic id so persistence is idempotent across recomputes.
 */
export async function gatherEvidenceEvents(sql, orgId, agentId, { sinceDays = DEFAULT_LOOKBACK_DAYS } = {}) {
  const events = [];

  const actions = await sql`
    SELECT action_id, status, outcome_status, risk_score, approved_by, error_message, created_at
    FROM action_records
    WHERE org_id = ${orgId} AND agent_id = ${agentId}
      AND created_at > NOW() - (${String(sinceDays)} || ' days')::interval`;
  for (const a of actions) {
    const occurred_at = a.created_at;
    const outcome = terminalOutcome(a.outcome_status, a.status);
    if (outcome !== null) events.push({ id: `are_o_${a.action_id}`, event_type: 'outcome', value: outcome, occurred_at, action_id: a.action_id });
    if (a.risk_score != null) events.push({ id: `are_r_${a.action_id}`, event_type: 'risk', value: Number(a.risk_score) || 0, occurred_at, action_id: a.action_id });
    if (a.approved_by) events.push({ id: `are_a_${a.action_id}`, event_type: 'approval', value: 1, occurred_at, action_id: a.action_id });
    else if (a.error_message && /denied by human/i.test(a.error_message)) events.push({ id: `are_a_${a.action_id}`, event_type: 'approval', value: 0, occurred_at, action_id: a.action_id });
  }

  const guard = await sql`
    SELECT id, decision, created_at FROM guard_decisions
    WHERE org_id = ${orgId} AND agent_id = ${agentId}
      AND created_at > NOW() - (${String(sinceDays)} || ' days')::interval`;
  for (const g of guard) {
    events.push({ id: `are_g_${g.id}`, event_type: 'policy_violation', value: g.decision === 'block' ? 1 : 0, occurred_at: g.created_at });
  }

  const evals = await sql`
    SELECT es.id, es.score, es.created_at
    FROM eval_scores es
    JOIN action_records ar ON ar.action_id = es.action_id AND ar.org_id = es.org_id
    WHERE es.org_id = ${orgId} AND ar.agent_id = ${agentId}
      AND es.created_at > NOW() - (${String(sinceDays)} || ' days')::interval`;
  for (const e of evals) {
    const v = Number(e.score);
    if (Number.isFinite(v)) events.push({ id: `are_q_${e.id}`, event_type: 'quality', value: Math.max(0, Math.min(1, v)), occurred_at: e.created_at });
  }

  const feedback = await sql`
    SELECT id, rating, created_at FROM feedback
    WHERE org_id = ${orgId} AND agent_id = ${agentId} AND rating IS NOT NULL
      AND created_at > NOW() - (${String(sinceDays)} || ' days')::interval`;
  for (const f of feedback) {
    const r = Number(f.rating);
    if (Number.isFinite(r)) events.push({ id: `are_f_${f.id}`, event_type: 'quality', value: Math.max(0, Math.min(1, r / 5)), occurred_at: f.created_at });
  }

  return events;
}

async function persistEvents(sql, orgId, agentId, events) {
  for (const ev of events) {
    await sql`
      INSERT INTO agent_reputation_events (id, org_id, agent_id, event_type, value, action_id, occurred_at)
      VALUES (${ev.id}, ${orgId}, ${agentId}, ${ev.event_type}, ${ev.value}, ${ev.action_id || null}, ${ev.occurred_at})
      ON CONFLICT (id) DO NOTHING`;
  }
}

// ---- recompute orchestrator -------------------------------------------------

/**
 * Recompute the reputation vector for an agent from live evidence, persist the
 * derived events (idempotently) and the snapshot, sign and store a receipt, and
 * return { vector, receipt }. Reuses the instance Ed25519 signing key.
 */
export async function recomputeReputation(sql, orgId, agentId, { now = new Date().toISOString(), sinceDays = DEFAULT_LOOKBACK_DAYS } = {}) {
  const events = await gatherEvidenceEvents(sql, orgId, agentId, { sinceDays });
  await persistEvents(sql, orgId, agentId, events);

  const vector = computeVector(agentId, events, { now });
  await upsertReputationSnapshot(sql, orgId, agentId, vector);

  const key = await getServerSigningKey(sql);
  const receipt = buildReputationReceipt(vector, { kid: key.kid, privateKeyJwk: key.privateKeyJwk }, vector.computed_at);
  await insertReputationReceipt(sql, orgId, agentId, { receipt, kid: key.kid, issuedAt: vector.computed_at });

  return { vector, receipt };
}

/**
 * Read-only: compute the current vector from live evidence without persisting
 * anything. Used by GET endpoints so a read never has side effects; the
 * persisting + signing path is recomputeReputation (POST).
 */
export async function computeReputationVector(sql, orgId, agentId, { now = new Date().toISOString(), sinceDays = DEFAULT_LOOKBACK_DAYS } = {}) {
  const events = await gatherEvidenceEvents(sql, orgId, agentId, { sinceDays });
  return computeVector(agentId, events, { now });
}

/**
 * Read-only: compute the current vector and sign a receipt for it without
 * persisting. Used by GET .../receipt when no stored receipt exists yet.
 */
export async function buildCurrentReceipt(sql, orgId, agentId, opts = {}) {
  const vector = await computeReputationVector(sql, orgId, agentId, opts);
  const key = await getServerSigningKey(sql);
  return buildReputationReceipt(vector, { kid: key.kid, privateKeyJwk: key.privateKeyJwk }, vector.computed_at);
}

/**
 * Coerce a stored snapshot row into the vector shape. The Neon HTTP driver
 * returns numeric columns as strings, so coerce with Number() before returning.
 */
export function snapshotToVector(s) {
  if (!s) return null;
  const num = (v) => (v == null ? null : Number(v));
  return {
    agent_id: s.agent_id,
    reliability_score: num(s.reliability_score),
    completion_rate: num(s.completion_rate),
    policy_violation_rate: num(s.policy_violation_rate),
    approval_adherence: num(s.approval_adherence),
    quality_score: num(s.quality_score),
    risk_score: s.risk_score == null ? null : Number(s.risk_score),
    volume_weight: num(s.volume_weight),
    confidence: num(s.confidence),
    total_events: Number(s.total_events) || 0,
    last_event_at: s.last_event_at,
    computed_at: s.computed_at,
  };
}
