export type Dimension =
  | 'identity' | 'enforcement' | 'spend' | 'auditability' | 'approval' | 'data_protection';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type Decision = 'allow' | 'warn' | 'require_approval' | 'block';

export interface GovernableUnit {
  key: string;                 // capability slug, or `action_type:<type>`
  surfaceType: 'capability' | 'action_type';
  riskLevel: RiskLevel;        // capability.risk_level, or bucketed action_records.risk_score
  reversible: boolean;         // from action_records; default true when unknown
  hasSpendExposure: boolean;   // pricing_json non-empty | source_type external_marketplace | x402 provider
  requiresApproval: boolean;   // capability.requires_approval — DECLARED intent, not coverage
  observedCount: number;       // from action_records
  dimension: Dimension;        // primary dimension this unit maps to
}

export interface CoverageResult { grade: 0 | 0.5 | 1; hasFiringPolicy: boolean; infraOk: boolean; }

export interface Incident { unitKey: string; actionId: string; riskLevel: RiskLevel; ts: string; }

export interface Adjustments {
  incidents: Incident[];                 // ungoverned high-risk actions that fired (trailing window)
  approvalFollowThrough: number;         // 0..1 resolved/(resolved+abandoned); 1 when none
  coachOpenGapUnitKeys: string[];        // high-confidence un-adopted Policy Coach suggestions
}

export interface DimensionScore { dimension: Dimension; score: number; weight: number; }
export interface PostureScore {
  score: number;                         // 0-100, integer
  status: 'healthy' | 'needs_attention' | 'at_risk';
  dimensions: DimensionScore[];
  cappedBy: 'incident' | null;
}
