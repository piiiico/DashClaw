/**
 * Recovery Recipe Engine.
 * Maps signals to recovery suggestions and auto-actions.
 * Wired into the guard response via Task 15.
 */

/**
 * @typedef {Object} RecoveryStep
 * @property {string} action - The action to take
 * @property {number} [timeout_ms] - Optional timeout for the action
 * @property {string} [new_permission_level] - Optional permission level change
 * @property {string} [required_level] - Optional required test level
 */

/**
 * @typedef {Object} RecoveryRecipe
 * @property {string} signal - The signal type this recipe handles
 * @property {string} suggestion - Human-readable suggestion text
 * @property {string|null} auto_action - Automated action to take, or null for manual-only
 * @property {string} escalation - Escalation level: warn_only | alert_human | block_until_resolved
 * @property {RecoveryStep[]} steps - Ordered list of recovery steps
 * @property {number} max_attempts - Maximum number of attempts before skipping
 */

/** @type {RecoveryRecipe[]} */
export const RECOVERY_RECIPES = [
  {
    signal: 'session_stalled',
    suggestion: 'Agent session appears stalled. Consider restarting the session.',
    auto_action: 'restart_session',
    escalation: 'alert_human',
    steps: [{ action: 'restart_session' }],
    max_attempts: 1,
  },
  {
    signal: 'branch_stale',
    suggestion: 'Branch is behind main. Rebase or merge-forward recommended before proceeding.',
    auto_action: null,
    escalation: 'warn_only',
    steps: [{ action: 'suggest_rebase' }],
    max_attempts: 1,
  },
  {
    signal: 'mcp_degraded',
    suggestion: 'MCP server is degraded. Retry handshake or check server configuration.',
    auto_action: 'retry_mcp_handshake',
    escalation: 'alert_human',
    steps: [{ action: 'retry_mcp_handshake', timeout_ms: 5000 }],
    max_attempts: 1,
  },
  {
    signal: 'repeated_failures',
    suggestion: 'Agent has repeated failures. Reducing autonomy to readonly.',
    auto_action: 'reduce_autonomy',
    escalation: 'alert_human',
    steps: [{ action: 'reduce_autonomy', new_permission_level: 'readonly' }],
    max_attempts: 1,
  },
  {
    signal: 'green_insufficient',
    suggestion: 'Tests must pass at workspace level before deploy/merge.',
    auto_action: null,
    escalation: 'block_until_resolved',
    steps: [{ action: 'suggest_test_run', required_level: 'workspace' }],
    max_attempts: 1,
  },
  {
    signal: 'assumption_drift',
    suggestion: 'Agent assumptions have been invalidated. Review reasoning before proceeding.',
    auto_action: null,
    escalation: 'warn_only',
    steps: [{ action: 'suggest_assumption_review' }],
    max_attempts: 1,
  },
];

// Index recipes by signal type for O(1) lookup
const RECIPE_INDEX = new Map(RECOVERY_RECIPES.map((r) => [r.signal, r]));

/**
 * Evaluate recovery recipes against a set of signals.
 *
 * @param {Array<{type: string, severity: string, agent_id: string}>} signals
 * @param {Object<string, Object<string, number>>} [attemptLog={}]
 *   Shape: { [signalType]: { [agentId]: attemptCount } }
 * @returns {Array<{signal: string, agent_id: string, suggestion: string, auto_action: string|null, escalation: string, steps: RecoveryStep[]}>}
 */
export function evaluateRecoveryRecipes(signals, attemptLog = {}) {
  const results = [];

  for (const signal of signals) {
    const recipe = RECIPE_INDEX.get(signal.type);
    if (!recipe) continue;

    // Check whether attempts have been exhausted for this signal+agent
    const agentAttempts = attemptLog[signal.type]?.[signal.agent_id] ?? 0;
    if (agentAttempts >= recipe.max_attempts) continue;

    results.push({
      signal: recipe.signal,
      agent_id: signal.agent_id,
      suggestion: recipe.suggestion,
      auto_action: recipe.auto_action,
      escalation: recipe.escalation,
      steps: recipe.steps,
    });
  }

  return results;
}
