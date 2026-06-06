interface DemoScoringDimension {
  id: string;
  name: string;
  data_source: string;
  weight: number;
  scale: unknown[];
}

interface DemoScoringProfile {
  id: string;
  name: string;
  description: string;
  action_type: string;
  composite_method: string;
  status: string;
  dimensions: DemoScoringDimension[];
}

export const demoScoringProfiles: DemoScoringProfile[] = [
  {
    id: 'prof_01',
    name: 'Production Deploy Quality',
    description: 'Balanced score for evaluating the safety and efficiency of production deployments.',
    action_type: 'deploy',
    composite_method: 'weighted_average',
    status: 'active',
    dimensions: [
      { id: 'dim_01', name: 'Risk Control', data_source: 'risk_score', weight: 0.4, scale: [] },
      { id: 'dim_02', name: 'Confidence', data_source: 'confidence', weight: 0.3, scale: [] },
      { id: 'dim_03', name: 'Latency', data_source: 'duration_ms', weight: 0.2, scale: [] },
      { id: 'dim_04', name: 'Cost Efficiency', data_source: 'cost_estimate', weight: 0.1, scale: [] },
    ]
  },
  {
    id: 'prof_02',
    name: 'Research Accuracy',
    description: 'Focuses on reasoning depth and evaluation scores for research tasks.',
    action_type: 'research',
    composite_method: 'geometric_mean',
    status: 'active',
    dimensions: [
      { id: 'dim_05', name: 'Eval Score', data_source: 'eval_score', weight: 0.6, scale: [] },
      { id: 'dim_06', name: 'Reasoning Depth', data_source: 'tokens_total', weight: 0.4, scale: [] },
    ]
  }
];

interface DemoRiskRule {
  condition: string;
  add: number;
}

interface DemoRiskTemplate {
  id: string;
  name: string;
  description: string;
  action_type: string | null;
  base_risk: number;
  rules: DemoRiskRule[];
}

export const demoRiskTemplates: DemoRiskTemplate[] = [
  {
    id: 'rt_01',
    name: 'Standard Production Safety',
    description: 'Increases risk based on environment and destructive potential.',
    action_type: null,
    base_risk: 20,
    rules: [
      { condition: "metadata.environment == 'production'", add: 30 },
      { condition: "metadata.modifies_data == true", add: 25 },
      { condition: "metadata.irreversible == true", add: 25 },
    ]
  },
  {
    id: 'rt_02',
    name: 'API Integrity Check',
    description: 'Risk template for monitoring high-traffic API interactions.',
    action_type: 'api',
    base_risk: 10,
    rules: [
      { condition: "metadata.auth_type == 'none'", add: 50 },
      { condition: "metadata.is_external == true", add: 20 },
    ]
  }
];

interface DemoDimensionScore {
  dimension_name: string;
  score: number;
  label: string;
}

interface DemoScoringScore {
  id: string;
  profile_id: string;
  profile_name: string;
  action_id: string;
  composite_score: number;
  dimension_scores: DemoDimensionScore[];
  created_at: string;
}

export const demoScoringScores: DemoScoringScore[] = [
  {
    id: 'sc_01',
    profile_id: 'prof_01',
    profile_name: 'Production Deploy Quality',
    action_id: 'act_demo_1',
    composite_score: 88,
    dimension_scores: [
      { dimension_name: 'Risk Control', score: 92, label: 'excellent' },
      { dimension_name: 'Confidence', score: 85, label: 'excellent' },
      { dimension_name: 'Latency', score: 78, label: 'good' },
      { dimension_name: 'Cost Efficiency', score: 95, label: 'excellent' },
    ],
    created_at: new Date().toISOString()
  },
  {
    id: 'sc_02',
    profile_id: 'prof_01',
    profile_name: 'Production Deploy Quality',
    action_id: 'act_demo_2',
    composite_score: 62,
    dimension_scores: [
      { dimension_name: 'Risk Control', score: 45, label: 'poor' },
      { dimension_name: 'Confidence', score: 70, label: 'good' },
      { dimension_name: 'Latency', score: 82, label: 'excellent' },
      { dimension_name: 'Cost Efficiency', score: 60, label: 'acceptable' },
    ],
    created_at: new Date(Date.now() - 1000 * 60 * 45).toISOString()
  },
  {
    id: 'sc_03',
    profile_id: 'prof_02',
    profile_name: 'Research Accuracy',
    action_id: 'act_demo_3',
    composite_score: 94,
    dimension_scores: [
      { dimension_name: 'Eval Score', score: 98, label: 'excellent' },
      { dimension_name: 'Reasoning Depth', score: 88, label: 'excellent' },
    ],
    created_at: new Date(Date.now() - 1000 * 60 * 120).toISOString()
  }
];

interface DemoCalibrationScaleEntry {
  label: string;
  operator: string;
  value: number;
  score: number;
}

interface DemoCalibrationSuggestion {
  metric: string;
  data_source: string;
  sample_size: number;
  lower_is_better: boolean;
  suggested_weight: number;
  distribution: { min: number; p25: number; p75: number; max: number };
  suggested_scale: DemoCalibrationScaleEntry[];
}

interface DemoCalibration {
  status: string;
  count: number;
  lookback_days: number;
  action_type: string;
  suggestions: DemoCalibrationSuggestion[];
}

export const demoCalibration: DemoCalibration = {
  status: 'ok',
  count: 1540,
  lookback_days: 30,
  action_type: '(all)',
  suggestions: [
    {
      metric: 'duration_ms',
      data_source: 'duration_ms',
      sample_size: 1540,
      lower_is_better: true,
      suggested_weight: 0.25,
      distribution: { min: 120, p25: 800, p75: 2500, max: 12000 },
      suggested_scale: [
        { label: 'excellent', operator: '<=', value: 800, score: 100 },
        { label: 'good', operator: '<=', value: 1500, score: 80 },
        { label: 'acceptable', operator: '<=', value: 3000, score: 50 },
        { label: 'poor', operator: '>', value: 3000, score: 10 },
      ]
    },
    {
      metric: 'risk_score',
      data_source: 'risk_score',
      sample_size: 1540,
      lower_is_better: true,
      suggested_weight: 0.4,
      distribution: { min: 0, p25: 15, p75: 45, max: 100 },
      suggested_scale: [
        { label: 'excellent', operator: '<=', value: 20, score: 100 },
        { label: 'good', operator: '<=', value: 40, score: 80 },
        { label: 'acceptable', operator: '<=', value: 70, score: 40 },
        { label: 'poor', operator: '>', value: 70, score: 0 },
      ]
    }
  ]
};
