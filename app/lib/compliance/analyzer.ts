/**
 * Gap analysis engine
 * Analyzes compliance maps and generates actionable remediation plans
 * Absorbed from AI-Agent-Governance-Compliance-Kit/packages/compliance-engine/src/analyzer.js
 */

interface ComplianceControl {
  control_id: string;
  title: string;
  status: string;
  agent_relevance?: string;
  gap_recommendations: string[];
}

interface ComplianceSummary {
  coverage_percentage: number;
  [key: string]: unknown;
}

interface ComplianceMap {
  framework: string;
  controls: ComplianceControl[];
  summary: ComplianceSummary;
}

interface RemediationItem {
  priority: number;
  control_id: string;
  title: string;
  status: string;
  agent_relevance?: string;
  recommendations: string[];
  estimated_effort: string;
}

interface RiskAssessment {
  overall_risk: string;
  narrative: string;
  immediate_actions: string[];
}

/**
 * Run gap analysis on a compliance map
 */
export function analyzeGaps(complianceMap: ComplianceMap) {
  const { framework, controls, summary } = complianceMap;

  const gaps = controls.filter(c => c.status === 'gap');
  const partials = controls.filter(c => c.status === 'partial');

  const prioritizedGaps = [...gaps, ...partials].sort((a, b) => {
    const relevanceOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return (relevanceOrder[a.agent_relevance as string] ?? 3) - (relevanceOrder[b.agent_relevance as string] ?? 3);
  });

  const remediationPlan: RemediationItem[] = prioritizedGaps.map((control, index) => ({
    priority: index + 1,
    control_id: control.control_id,
    title: control.title,
    status: control.status,
    agent_relevance: control.agent_relevance,
    recommendations: control.gap_recommendations,
    estimated_effort: estimateEffort(control),
  }));

  const totalEffortHours = remediationPlan.reduce((sum, item) => {
    return sum + parseEffortHours(item.estimated_effort);
  }, 0);

  return {
    framework,
    analysis_date: new Date().toISOString(),
    summary: {
      ...summary,
      critical_gaps: gaps.filter(g => g.agent_relevance === 'critical').length,
      high_gaps: gaps.filter(g => g.agent_relevance === 'high').length,
      total_remediation_items: remediationPlan.length,
      estimated_total_effort: `${totalEffortHours}-${Math.round(totalEffortHours * 1.5)} hours`,
    },
    remediation_plan: remediationPlan,
    quick_wins: remediationPlan.filter(r => parseEffortHours(r.estimated_effort) <= 2),
    risk_assessment: generateRiskAssessment(summary, gaps),
  };
}

function estimateEffort(control: ComplianceControl): string {
  const recCount = control.gap_recommendations.length;
  if (recCount <= 1) return '1-2 hours';
  if (recCount <= 2) return '2-4 hours';
  if (recCount <= 3) return '4-8 hours';
  return '8-16 hours';
}

function parseEffortHours(effort: string): number {
  const match = effort.match(/(\d+)/);
  return match ? parseInt(match[1] as string, 10) : 4;
}

function generateRiskAssessment(summary: ComplianceSummary, gaps: ComplianceControl[]): RiskAssessment {
  const coveragePct = summary.coverage_percentage;

  const assessment: RiskAssessment = {
    overall_risk: 'LOW',
    narrative: '',
    immediate_actions: [],
  };

  if (coveragePct >= 80) {
    assessment.overall_risk = 'LOW';
    assessment.narrative = `Strong compliance posture with ${coveragePct}% coverage. Focus on closing remaining gaps to achieve full compliance.`;
  } else if (coveragePct >= 60) {
    assessment.overall_risk = 'MEDIUM';
    assessment.narrative = `Moderate compliance posture with ${coveragePct}% coverage. Several controls have gaps that should be addressed before the next audit cycle.`;
  } else if (coveragePct >= 40) {
    assessment.overall_risk = 'HIGH';
    assessment.narrative = `Below-target compliance posture with ${coveragePct}% coverage. Significant gaps exist that pose risk to audit readiness. Prioritize critical and high-relevance controls.`;
  } else {
    assessment.overall_risk = 'CRITICAL';
    assessment.narrative = `Critical compliance gaps with only ${coveragePct}% coverage. Immediate remediation required. Agent operations may not meet minimum regulatory requirements.`;
  }

  const criticalGaps = gaps.filter(g => g.agent_relevance === 'critical');
  for (const gap of criticalGaps) {
    assessment.immediate_actions.push(
      `Address ${gap.control_id} (${gap.title}): ${gap.gap_recommendations[0] || 'Review and remediate'}`
    );
  }

  return assessment;
}
