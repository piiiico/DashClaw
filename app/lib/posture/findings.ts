import type {
  GovernableUnit, Adjustments, PostureFinding, PostureFix, Severity, Dimension,
} from './types';
import { computeScore, unitWeight } from './model';

// Deterministic FNV-1a 32-bit hash → 8-hex. Stable finding keys across scans
// (NO Date.now / Math.random — keys must be reproducible, like Policy Coach ids).
function stableKey(parts: string[]): string {
  const s = parts.join(':');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// Which guard policy type a draft for each dimension should prefill.
const DIMENSION_POLICY: Record<Dimension, string> = {
  enforcement: 'risk_threshold',
  spend: 'x402_spend_limit',
  data_protection: 'protected_path',
  identity: 'require_approval',
  approval: 'require_approval',
  auditability: 'require_approval',
};

function draftRules(policyType: string): unknown {
  switch (policyType) {
    case 'risk_threshold': return { threshold: 50, action: 'require_approval' };
    case 'x402_spend_limit': return { max_spend_usd: 0, approval_threshold: 0 };
    case 'protected_path': return { paths: [], action: 'require_approval' };
    default: return { action: 'require_approval' };
  }
}

function severityForDelta(scoreDelta: number): Severity {
  if (scoreDelta >= 5) return 'critical';
  if (scoreDelta >= 3) return 'high';
  if (scoreDelta >= 1) return 'medium';
  return 'low';
}

/**
 * Pure: derive the prioritized remediation queue from the same inputs the score
 * engine uses. Produces create_policy_draft findings for under-covered units and
 * review_incident findings for active leaks. Richer fix types (bind_identity,
 * enable_setting, adopt_coach_suggestion) are layered on in signals enrichment,
 * where the extra context (agent ids, suggestion ids, deep links) exists.
 * Note: scoreDelta may be 0 for negligible-weight coverage gaps.
 */
export function deriveFindings(
  units: GovernableUnit[],
  coverageByKey: Record<string, number>,
  adj: Adjustments,
): PostureFinding[] {
  const totalWeight = units.reduce((s, u) => s + unitWeight(u), 0) || 1;
  const findings: PostureFinding[] = [];

  for (const u of units) {
    let grade = Math.max(0, Math.min(1, coverageByKey[u.key] ?? 0));
    if (adj.coachOpenGapUnitKeys.includes(u.key)) grade = Math.min(grade, 0.5);
    if (grade >= 1) continue;
    const scoreDelta = Math.round((unitWeight(u) * (1 - grade)) / totalWeight * 100);
    const policyType = DIMENSION_POLICY[u.dimension];
    const fix: PostureFix = { type: 'create_policy_draft', policyType, rules: draftRules(policyType) };
    const label = u.surfaceType === 'capability' ? 'Capability' : 'Action type';
    findings.push({
      key: stableKey([u.dimension, u.key, fix.type]),
      dimension: u.dimension,
      severity: severityForDelta(scoreDelta),
      title: `${label} "${u.key}" is not fully governed`,
      evidence: { observedCount: u.observedCount, exampleActionIds: [] },
      scoreDelta,
      fix,
      status: 'open',
    });
  }

  // Active leaks: attribute incident-cap relief across incident findings so they
  // sort above ordinary coverage gaps under the scoreDelta-first ordering.
  if (adj.incidents.length > 0) {
    const capped = computeScore(units, coverageByKey, adj);
    // Strip incidents to get the uncapped baseline; computeScore only reads adj arrays.
    const uncapped = computeScore(units, coverageByKey, { ...adj, incidents: [] });
    // Floor at 1 so an active leak always surfaces above zero-delta coverage gaps,
    // even when per-incident relief rounds down (or a non-cap-triggering incident
    // yields zero relief). inc.unitKey may be an action type not present in `units`.
    const reliefEach = Math.max(1, Math.round(Math.max(0, uncapped.score - capped.score) / adj.incidents.length));
    for (const inc of adj.incidents) {
      const fix: PostureFix = {
        type: 'review_incident',
        actionIds: [inc.actionId],
        // /decisions/:id is the canonical decision-replay route (stable path).
        deepLink: `/decisions/${inc.actionId}`,
      };
      findings.push({
        key: stableKey(['enforcement', 'incident', inc.unitKey, inc.actionId]),
        dimension: 'enforcement',
        severity: 'critical',
        title: `Ungoverned ${inc.riskLevel}-risk action reached allow`,
        evidence: { observedCount: 1, exampleActionIds: [inc.actionId] },
        scoreDelta: reliefEach,
        fix,
        status: 'open',
      });
    }
  }

  return findings.sort((a, b) =>
    b.scoreDelta - a.scoreDelta ||
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    b.evidence.observedCount - a.evidence.observedCount ||
    a.key.localeCompare(b.key),
  );
}
