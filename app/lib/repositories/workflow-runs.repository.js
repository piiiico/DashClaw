// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function safeJsonParse(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shape helpers
// ─────────────────────────────────────────────────────────────────────────────

export function shapeRun(row) {
  if (!row) return null;
  const trigger = row.trigger || '';
  const templateId = trigger.startsWith('workflow:') ? trigger.slice('workflow:'.length) : null;

  return {
    run_action_id: row.action_id,
    template_id: templateId,
    status: row.status || 'unknown',
    agent_id: row.agent_id || null,
    declared_goal: row.declared_goal || null,
    duration_ms: row.duration_ms || null,
    started_at: row.timestamp_start || null,
    finished_at: row.timestamp_end || null,
    error_message: row.error_message || null,
    step_count: parseInt(row.step_count, 10) || 0,
    steps_completed: parseInt(row.steps_completed, 10) || 0,
    steps_failed: parseInt(row.steps_failed, 10) || 0,
  };
}

export function shapeStepResult(row) {
  if (!row) return null;
  return {
    step_result_id: row.step_result_id,
    step_id: row.step_id,
    step_index: row.step_index,
    step_type: row.step_type,
    step_name: row.step_name || row.step_id,
    status: row.status,
    input: safeJsonParse(row.input_json),
    output: safeJsonParse(row.output_json),
    error_message: row.error_message || null,
    retry_count: row.retry_count || 0,
    duration_ms: row.duration_ms || null,
    started_at: row.started_at || null,
    finished_at: row.finished_at || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step result writes
// ─────────────────────────────────────────────────────────────────────────────

export async function insertStepResult(sql, { stepResultId, runActionId, orgId, templateId, stepData }) {
  // Idempotent insert: if a row already exists for (run_action_id, step_id)
  // reset it to 'running' rather than inserting a duplicate. Before this guard
  // a crash between insertStepResult and updateStepResult would leave a stale
  // 'running' row on disk, and resume would insert a second row with a new
  // step_result_id — getWorkflowRun then returned duplicate steps and
  // buildResumeContext would read whichever landed first in step_index order.
  const existing = await sql`
    SELECT 1 FROM workflow_step_results
    WHERE run_action_id = ${runActionId}
      AND org_id = ${orgId}
      AND step_id = ${stepData.step_id}
    LIMIT 1
  `;

  if (existing.length > 0) {
    await sql`
      UPDATE workflow_step_results
      SET status = 'running',
          input_json = ${JSON.stringify(stepData.input_json)},
          started_at = ${stepData.started_at},
          output_json = NULL,
          error_message = NULL,
          retry_count = 0,
          duration_ms = NULL,
          finished_at = NULL
      WHERE run_action_id = ${runActionId}
        AND org_id = ${orgId}
        AND step_id = ${stepData.step_id}
    `;
    return;
  }

  await sql`
    INSERT INTO workflow_step_results (
      step_result_id, run_action_id, org_id, template_id,
      step_id, step_index, step_type, step_name,
      status, input_json, started_at
    ) VALUES (
      ${stepResultId}, ${runActionId}, ${orgId}, ${templateId},
      ${stepData.step_id}, ${stepData.step_index}, ${stepData.step_type}, ${stepData.step_name},
      'running', ${JSON.stringify(stepData.input_json)}, ${stepData.started_at}
    )
  `;
}

export async function updateStepResult(sql, { runActionId, orgId, stepData }) {
  // CAS on status='running' so a later write (e.g. a stale retry, a
  // concurrent resume that races against cancelWorkflowRun, or a
  // duplicate persistStepResult call) cannot overwrite a row that has
  // already reached a terminal state (completed / failed / cancelled).
  // The first writer to transition the row out of 'running' wins; any
  // subsequent writer matches zero rows and is silently a no-op.
  await sql`
    UPDATE workflow_step_results
    SET status = ${stepData.status},
        output_json = ${stepData.output_json ? JSON.stringify(stepData.output_json) : null},
        error_message = ${stepData.error_message || null},
        retry_count = ${stepData.retry_count || 0},
        duration_ms = ${stepData.duration_ms || null},
        finished_at = ${stepData.finished_at || null}
    WHERE run_action_id = ${runActionId}
      AND org_id = ${orgId}
      AND step_id = ${stepData.step_id}
      AND status = 'running'
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resume context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build resume context from a prior run's step results.
 * Returns { resumeFromIndex, priorSteps, failedStepId } or null if nothing to resume.
 *
 * @param {Array} stepResults - step_result rows ordered by step_index
 * @param {string|null} fromStepId - optional step_id to resume from (re-runs that step)
 */
export function buildResumeContext(stepResults, fromStepId = null) {
  if (!stepResults || stepResults.length === 0) return null;

  let resumeFromIndex;
  let failedStepId = null;

  if (fromStepId) {
    const targetStep = stepResults.find((s) => s.step_id === fromStepId);
    if (!targetStep) return null;
    resumeFromIndex = targetStep.step_index;
  } else {
    const firstNonCompleted = stepResults.find(
      (s) => s.status !== 'completed' && s.status !== 'skipped' && s.status !== 'reused',
    );
    if (!firstNonCompleted) return null; // all completed — nothing to resume
    resumeFromIndex = firstNonCompleted.step_index;
    failedStepId = firstNonCompleted.step_id;
  }

  const priorSteps = {};
  for (const step of stepResults) {
    if (step.step_index >= resumeFromIndex) break;
    if (step.status !== 'completed') continue; // skip skipped/failed steps
    // Steps arrive already shaped (getWorkflowRun maps rows through
    // shapeStepResult), so the parsed output is on `output`, not the raw
    // `output_json` column — reading output_json silently dropped every
    // prior step's output on resume.
    priorSteps[step.step_id] = {
      output: step.output,
    };
  }

  return { resumeFromIndex, priorSteps, failedStepId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Query functions
// ─────────────────────────────────────────────────────────────────────────────

export async function listWorkflowRuns(sql, orgId, templateId, filters = {}) {
  const { status, agent_id, limit = 20, offset = 0 } = filters;
  const parsedLimit = Math.min(parseInt(limit, 10) || 20, 100);
  const parsedOffset = parseInt(offset, 10) || 0;
  const triggerMatch = `workflow:${templateId}`;

  const rows = await sql`
    SELECT
      a.action_id,
      a.status,
      a.agent_id,
      a.declared_goal,
      a.trigger,
      a.duration_ms,
      a.timestamp_start,
      a.timestamp_end,
      a.error_message,
      COALESCE(s.step_count, 0) AS step_count,
      COALESCE(s.steps_completed, 0) AS steps_completed,
      COALESCE(s.steps_failed, 0) AS steps_failed
    FROM action_records a
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS step_count,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS steps_completed,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS steps_failed
      FROM workflow_step_results
      WHERE run_action_id = a.action_id AND org_id = ${orgId}
    ) s ON true
    WHERE a.org_id = ${orgId}
      AND a.action_type = 'workflow_execute'
      AND a.trigger = ${triggerMatch}
      ${status ? sql`AND a.status = ${status}` : sql``}
      ${agent_id ? sql`AND a.agent_id = ${agent_id}` : sql``}
    ORDER BY a.timestamp_start::timestamptz DESC
    LIMIT ${parsedLimit}
    OFFSET ${parsedOffset}
  `;

  const countRows = await sql`
    SELECT COUNT(*)::int AS total
    FROM action_records
    WHERE org_id = ${orgId}
      AND action_type = 'workflow_execute'
      AND trigger = ${triggerMatch}
      ${status ? sql`AND status = ${status}` : sql``}
      ${agent_id ? sql`AND agent_id = ${agent_id}` : sql``}
  `;

  return {
    runs: rows.map(shapeRun),
    total: countRows[0]?.total || 0,
  };
}

export async function cancelWorkflowRun(sql, orgId, runActionId) {
  // Verify the run exists and is running
  const rows = await sql`
    SELECT action_id, status
    FROM action_records
    WHERE org_id = ${orgId}
      AND action_id = ${runActionId}
      AND action_type = 'workflow_execute'
    LIMIT 1
  `;

  if (rows.length === 0) return { found: false };
  if (rows[0].status !== 'running') return { found: true, running: false, status: rows[0].status };

  const now = new Date().toISOString();

  // Cancel the parent action with a status CAS so a concurrent
  // executeWorkflow that transitions 'running' → 'completed'/'failed'
  // between the read above and this UPDATE does not have its terminal
  // outcome overwritten. RETURNING lets us distinguish the cancel from
  // the lost-the-race case.
  const cancelled = await sql`
    UPDATE action_records
    SET status = 'cancelled',
        error_message = 'Cancelled by operator',
        timestamp_end = ${now}
    WHERE action_id = ${runActionId}
      AND org_id = ${orgId}
      AND status = 'running'
    RETURNING action_id
  `;

  if (cancelled.length === 0) {
    // Race lost — the workflow reached a terminal state before the
    // cancel UPDATE ran. Re-read the current status and return it so
    // the caller can surface "already completed/failed" instead of a
    // misleading cancelled confirmation.
    const latest = await sql`
      SELECT status FROM action_records
      WHERE org_id = ${orgId} AND action_id = ${runActionId}
      LIMIT 1
    `;
    return { found: true, running: false, status: latest[0]?.status ?? 'unknown' };
  }

  // Cancel any step results still marked running. Children that already
  // completed stay as-is — this mirrors the parent CAS pattern.
  await sql`
    UPDATE workflow_step_results
    SET status = 'cancelled',
        error_message = 'Cancelled by operator',
        finished_at = ${now}
    WHERE run_action_id = ${runActionId}
      AND org_id = ${orgId}
      AND status = 'running'
  `;

  return { found: true, running: true, status: 'cancelled' };
}

export async function getWorkflowRun(sql, orgId, runActionId) {
  const actionRows = await sql`
    SELECT
      action_id, status, agent_id, declared_goal, trigger,
      duration_ms, timestamp_start, timestamp_end, error_message, reasoning
    FROM action_records
    WHERE org_id = ${orgId}
      AND action_id = ${runActionId}
      AND action_type = 'workflow_execute'
    LIMIT 1
  `;

  if (actionRows.length === 0) return null;

  const run = shapeRun(actionRows[0]);

  const reasoning = safeJsonParse(actionRows[0].reasoning);
  run.template_name = reasoning?.template_name || null;

  const stepRows = await sql`
    SELECT
      step_result_id, step_id, step_index, step_type, step_name,
      status, input_json, output_json, error_message,
      retry_count, duration_ms, started_at, finished_at
    FROM workflow_step_results
    WHERE run_action_id = ${runActionId}
      AND org_id = ${orgId}
    ORDER BY step_index ASC
  `;

  run.steps = stepRows.map(shapeStepResult);
  run.step_count = run.steps.length;
  run.steps_completed = run.steps.filter((s) => s.status === 'completed').length;
  run.steps_failed = run.steps.filter((s) => s.status === 'failed').length;

  return run;
}
