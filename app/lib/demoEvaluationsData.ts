export const demoEvalScorers = [
  { id: 'scr_01', name: 'Success Regex', scorer_type: 'regex', description: 'Checks if output contains success markers', total_scores: 142, avg_score: 0.92, config: { pattern: 'success|completed|ok' } },
  { id: 'scr_02', name: 'Risk Auditor', scorer_type: 'numeric_range', description: 'Ensures risk score is within acceptable bounds', total_scores: 85, avg_score: 0.78, config: { min: 0, max: 70, field: 'risk_score' } },
  { id: 'scr_03', name: 'LLM Quality Judge', scorer_type: 'llm_judge', description: 'AI-based reasoning and quality assessment', total_scores: 24, avg_score: 0.85, config: { model: 'gpt-4o' } },
];

export const demoEvalScores = [
  { id: 'evs_01', action_id: 'act_demo_1', scorer_id: 'scr_01', scorer_name: 'Success Regex', score: 1.0, label: 'pass', evaluated_by: 'system', created_at: new Date().toISOString() },
  { id: 'evs_02', action_id: 'act_demo_2', scorer_id: 'scr_02', scorer_name: 'Risk Auditor', score: 0.85, label: 'pass', evaluated_by: 'system', created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString() },
  { id: 'evs_03', action_id: 'act_demo_3', scorer_id: 'scr_03', scorer_name: 'LLM Quality Judge', score: 0.92, label: 'pass', evaluated_by: 'human', created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString() },
  { id: 'evs_04', action_id: 'act_demo_4', scorer_id: 'scr_01', scorer_name: 'Success Regex', score: 0.0, label: 'fail', evaluated_by: 'system', created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },
  { id: 'evs_05', action_id: 'act_demo_5', scorer_id: 'scr_02', scorer_name: 'Risk Auditor', score: 0.45, label: 'fail', evaluated_by: 'system', created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString() },
  { id: 'evs_06', action_id: 'act_demo_6', scorer_id: 'scr_03', scorer_name: 'LLM Quality Judge', score: 0.78, label: 'pass', evaluated_by: 'human', created_at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString() },
];

export const demoEvalRuns = [
  { id: 'run_01', name: 'Weekly Compliance Audit', scorer_id: 'scr_02', scorer_name: 'Risk Auditor', status: 'completed', scored_count: 50, total_actions: 50, avg_score: 0.82, created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString() },
  { id: 'run_02', name: 'Production Quality Check', scorer_id: 'scr_03', scorer_name: 'LLM Quality Judge', status: 'running', scored_count: 12, total_actions: 45, avg_score: 0.88, created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },
];

export const demoEvalStats = {
  overall: {
    total_scores: 251,
    avg_score: 0.84,
    unique_scorers: 3,
    today_count: 14,
  },
  distribution: [
    { bucket: 'poor', count: 12 },
    { bucket: 'acceptable', count: 45 },
    { bucket: 'excellent', count: 194 },
  ],
};
