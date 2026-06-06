function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * clamp(q, 0, 1);
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base] as number;
  return (sorted[base] as number) + rest * ((sorted[base + 1] as number) - (sorted[base] as number));
}

export function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

type OutcomeLabel = 'success' | 'failure' | 'pending';

function asOutcomeLabel(status: string): OutcomeLabel {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'failure';
  return 'pending';
}

/** Snapshot of an action used to score a learning episode. */
export interface ActionEpisodeSnapshot {
  status?: unknown;
  risk_score?: unknown;
  reversible?: unknown;
  duration_ms?: unknown;
  cost_estimate?: unknown;
  confidence?: unknown;
  invalidated_assumptions?: unknown;
  open_loops?: unknown;
}

export interface EpisodeScoreBreakdown {
  base: number;
  status: number;
  risk: number;
  reversibility: number;
  duration: number;
  cost: number;
  confidence: number;
  invalidated_assumptions: number;
  open_loops: number;
}

export interface EpisodeScore {
  score: number;
  outcome_label: OutcomeLabel;
  breakdown: EpisodeScoreBreakdown;
}

export function scoreActionEpisode(snapshot: ActionEpisodeSnapshot): EpisodeScore {
  const status = String(snapshot.status || 'pending');
  const riskScore = clamp(Math.round(toNumber(snapshot.risk_score, 0)), 0, 100);
  const reversible = toBool(snapshot.reversible);
  const durationMs = toNullableNumber(snapshot.duration_ms);
  const costEstimate = toNullableNumber(snapshot.cost_estimate);
  const confidence = clamp(Math.round(toNumber(snapshot.confidence, 50)), 0, 100);
  const invalidatedAssumptions = Math.max(0, Math.round(toNumber(snapshot.invalidated_assumptions, 0)));
  const openLoops = Math.max(0, Math.round(toNumber(snapshot.open_loops, 0)));

  const breakdown: EpisodeScoreBreakdown = {
    base: 50,
    status: 0,
    risk: 0,
    reversibility: 0,
    duration: 0,
    cost: 0,
    confidence: 0,
    invalidated_assumptions: 0,
    open_loops: 0,
  };

  if (status === 'completed') breakdown.status += 30;
  else if (status === 'failed') breakdown.status -= 35;
  else if (status === 'cancelled') breakdown.status -= 20;
  else if (status === 'pending_approval') breakdown.status -= 8;
  else if (status === 'running') breakdown.status -= 5;

  if (riskScore > 60) {
    breakdown.risk -= Math.min(20, Math.round((riskScore - 60) / 2));
  } else if (riskScore <= 30) {
    breakdown.risk += 4;
  }

  breakdown.reversibility += reversible ? 5 : -8;

  if (durationMs !== null) {
    if (durationMs <= 60_000) breakdown.duration += 6;
    else if (durationMs <= 300_000) breakdown.duration += 3;
    else if (durationMs <= 1_800_000) breakdown.duration -= 4;
    else breakdown.duration -= 10;
  }

  if (costEstimate !== null) {
    if (costEstimate <= 0.05) breakdown.cost += 4;
    else if (costEstimate <= 1) breakdown.cost += 1;
    else if (costEstimate <= 5) breakdown.cost -= 4;
    else breakdown.cost -= 8;
  }

  if (status === 'completed' && confidence >= 70) breakdown.confidence += 4;
  if (status === 'failed' && confidence >= 80) breakdown.confidence -= 8;

  breakdown.invalidated_assumptions -= Math.min(16, invalidatedAssumptions * 4);
  breakdown.open_loops -= Math.min(10, openLoops * 2);

  const rawScore = Object.values(breakdown).reduce((sum, n) => sum + n, 0);
  const score = clamp(Math.round(rawScore), 0, 100);

  return {
    score,
    outcome_label: asOutcomeLabel(status),
    breakdown,
  };
}

interface RecommendationHints {
  preferred_risk_cap: number | null;
  prefer_reversible: boolean;
  confidence_floor: number | null;
  expected_duration_ms: number | null;
  expected_cost_estimate: number | null;
}

function buildGuidanceHints(hints: RecommendationHints, sampleSize: number, successRate: number): string[] {
  const guidance: string[] = [];
  if (typeof hints.preferred_risk_cap === 'number') {
    guidance.push(`Keep risk_score at or below ${hints.preferred_risk_cap} for this action type.`);
  }
  if (hints.prefer_reversible === true) {
    guidance.push('Prefer reversible execution strategies where possible.');
  }
  if (typeof hints.confidence_floor === 'number') {
    guidance.push(`Target confidence >= ${hints.confidence_floor} before executing.`);
  }
  if (typeof hints.expected_duration_ms === 'number') {
    guidance.push(`Typical successful runtime is around ${hints.expected_duration_ms}ms.`);
  }
  if (typeof hints.expected_cost_estimate === 'number') {
    guidance.push(`Typical successful cost is about $${hints.expected_cost_estimate.toFixed(2)}.`);
  }
  if (sampleSize < 8) {
    guidance.push('Small sample size: treat this recommendation as provisional.');
  }
  if (successRate < 0.5) {
    guidance.push('Historical success rate is low: consider additional guard checks.');
  }
  return guidance;
}

/** Raw episode row used to derive recommendations. Fields are loosely typed (DB/JSON-sourced). */
export interface RecommendationEpisode {
  agent_id?: string | null;
  action_type?: string | null;
  score?: unknown;
  risk_score?: unknown;
  confidence?: unknown;
  duration_ms?: unknown;
  cost_estimate?: unknown;
  reversible?: unknown;
  outcome_label?: unknown;
  [key: string]: unknown;
}

export interface BuildRecommendationsOptions {
  minSamples?: number;
}

export interface Recommendation {
  agent_id: string | null | undefined;
  action_type: string | null | undefined;
  sample_size: number;
  top_sample_size: number;
  success_rate: number;
  avg_score: number;
  confidence: number;
  hints: RecommendationHints;
  guidance: string[];
}

export function buildRecommendationsFromEpisodes(
  episodes: RecommendationEpisode[],
  options: BuildRecommendationsOptions = {},
): Recommendation[] {
  const minSamples = Math.max(2, Math.min(100, Number(options.minSamples) || 5));
  const grouped = new Map<string, RecommendationEpisode[]>();

  for (const episode of episodes) {
    if (!episode?.agent_id || !episode?.action_type) continue;
    const key = `${episode.agent_id}::${episode.action_type}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(episode);
  }

  const recommendations: Recommendation[] = [];

  for (const group of grouped.values()) {
    if (group.length < minSamples) continue;

    const sortedByScore = [...group].sort((a, b) => toNumber(b.score, 0) - toNumber(a.score, 0));
    const topSampleSize = Math.max(3, Math.ceil(group.length * 0.35));
    const topEpisodes = sortedByScore.slice(0, topSampleSize);

    const riskValues = topEpisodes.map((e) => toNullableNumber(e.risk_score)).filter((v): v is number => v !== null);
    const confidenceValues = topEpisodes.map((e) => toNullableNumber(e.confidence)).filter((v): v is number => v !== null);
    const durationValues = topEpisodes.map((e) => toNullableNumber(e.duration_ms)).filter((v): v is number => v !== null);
    const costValues = topEpisodes.map((e) => toNullableNumber(e.cost_estimate)).filter((v): v is number => v !== null);
    const reversibleRatio = average(topEpisodes.map((e) => (toBool(e.reversible) ? 1 : 0)));

    const allScores = group.map((e) => toNumber(e.score, 0));
    const avgScore = average(allScores);
    const successRate = average(
      group.map((e) => (String(e.outcome_label || '') === 'success' ? 1 : 0)),
    );

    const hints: RecommendationHints = {
      preferred_risk_cap: riskValues.length ? Math.round(quantile(riskValues, 0.75) as number) : null,
      prefer_reversible: reversibleRatio >= 0.6,
      confidence_floor: confidenceValues.length ? Math.round(quantile(confidenceValues, 0.25) as number) : null,
      expected_duration_ms: durationValues.length ? Math.round(quantile(durationValues, 0.5) as number) : null,
      expected_cost_estimate: costValues.length
        ? Math.round((quantile(costValues, 0.5) as number) * 100) / 100
        : null,
    };

    const confidence = clamp(
      Math.round(35 + Math.min(25, group.length * 2) + successRate * 25 + (avgScore - 50) * 0.4),
      35,
      95,
    );

    const first = group[0] as RecommendationEpisode;
    recommendations.push({
      agent_id: first.agent_id,
      action_type: first.action_type,
      sample_size: group.length,
      top_sample_size: topEpisodes.length,
      success_rate: Number(successRate.toFixed(4)),
      avg_score: Number(avgScore.toFixed(2)),
      confidence,
      hints,
      guidance: buildGuidanceHints(hints, group.length, successRate),
    });
  }

  return recommendations.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.sample_size - a.sample_size;
  });
}
