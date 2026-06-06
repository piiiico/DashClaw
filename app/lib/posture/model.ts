import type {
  RiskLevel, GovernableUnit, CoverageResult, Decision,
  Adjustments, Dimension, DimensionScore, PostureScore,
} from './types';

const RISK_MULTIPLIER: Record<RiskLevel, number> = { low: 1, medium: 3, high: 8, critical: 16 };

export function riskFactor(level: RiskLevel): number { return RISK_MULTIPLIER[level]; }

export function bucketRiskScore(score: number): RiskLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

export function frequencyFactor(count: number): number {
  return 1 + Math.log10(1 + Math.max(0, count));
}

export function unitWeight(u: GovernableUnit): number {
  const reversibility = u.reversible ? 1 : 2;
  const spend = u.hasSpendExposure ? 2 : 1;
  return riskFactor(u.riskLevel) * reversibility * spend * frequencyFactor(u.observedCount);
}

const GRADE: Record<Decision, 0 | 0.5 | 1> = { allow: 0, warn: 0.5, require_approval: 1, block: 1 };

export function gradeCoverage(
  u: GovernableUnit,
  replay: (unitKey: string) => Decision,
  infraOk: (u: GovernableUnit) => boolean,
): CoverageResult {
  const decision = replay(u.key);
  const baseGrade = GRADE[decision];
  const ok = infraOk(u);
  const grade = ok ? baseGrade : 0;
  return { grade, hasFiringPolicy: baseGrade > 0, infraOk: ok };
}

const DIMENSIONS: Dimension[] = ['identity','enforcement','spend','auditability','approval','data_protection'];

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }

export function applyIncidentCap(score: number, adj: Adjustments): { score: number; cappedBy: 'incident' | null } {
  const hasHighIncident = adj.incidents.some((i) => i.riskLevel === 'high' || i.riskLevel === 'critical');
  if (hasHighIncident) return { score: Math.min(score, 60), cappedBy: 'incident' };
  return { score, cappedBy: null };
}

export function computeScore(
  units: GovernableUnit[],
  coverageByKey: Record<string, number>, // unitKey -> grade 0..1 (per-unit, deduped by construction)
  adj: Adjustments,
): PostureScore {
  const byDim = new Map<Dimension, { covered: number; total: number }>();
  for (const d of DIMENSIONS) byDim.set(d, { covered: 0, total: 0 });

  for (const u of units) {
    const w = unitWeight(u);
    let grade = clamp01(coverageByKey[u.key] ?? 0);
    if (adj.coachOpenGapUnitKeys.includes(u.key)) grade = Math.min(grade, 0.5); // observed uncovered risk
    const bucket = byDim.get(u.dimension)!;
    bucket.total += w;
    bucket.covered += grade * w;
  }

  const dimensions: DimensionScore[] = DIMENSIONS.map((d) => {
    const { covered, total } = byDim.get(d)!;
    return { dimension: d, score: total === 0 ? 100 : Math.round((covered / total) * 100), weight: total };
  });

  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const rawCovered = DIMENSIONS.reduce((s, d) => s + byDim.get(d)!.covered, 0);
  let score = totalWeight === 0 ? 100 : Math.round((rawCovered / totalWeight) * 100);

  // approval follow-through nudges the overall contribution slightly
  score = Math.round(score * (0.9 + 0.1 * clamp01(adj.approvalFollowThrough)));

  const capped = applyIncidentCap(score, adj);
  const status: PostureScore['status'] =
    capped.score >= 85 ? 'healthy' : capped.score >= 60 ? 'needs_attention' : 'at_risk';
  return { score: capped.score, status, dimensions, cappedBy: capped.cappedBy };
}
