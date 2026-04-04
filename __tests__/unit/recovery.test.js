import { describe, expect, it } from 'vitest';
import { evaluateRecoveryRecipes, RECOVERY_RECIPES } from '../../app/lib/recovery.js';

describe('RECOVERY_RECIPES', () => {
  it('has exactly 6 entries', () => {
    expect(RECOVERY_RECIPES).toHaveLength(6);
  });

  it('each recipe has required fields', () => {
    for (const recipe of RECOVERY_RECIPES) {
      expect(recipe).toHaveProperty('signal');
      expect(recipe).toHaveProperty('suggestion');
      expect(recipe).toHaveProperty('auto_action');
      expect(recipe).toHaveProperty('escalation');
      expect(recipe).toHaveProperty('steps');
      expect(recipe).toHaveProperty('max_attempts');
      expect(Array.isArray(recipe.steps)).toBe(true);
      expect(recipe.steps.length).toBeGreaterThan(0);
      expect(recipe.max_attempts).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('evaluateRecoveryRecipes', () => {
  it('returns suggestion containing "Rebase" for branch_stale signal', () => {
    const signals = [{ type: 'branch_stale', severity: 'amber', agent_id: 'agent-1' }];
    const recipes = evaluateRecoveryRecipes(signals);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].suggestion).toContain('Rebase');
    expect(recipes[0].signal).toBe('branch_stale');
    expect(recipes[0].agent_id).toBe('agent-1');
    expect(recipes[0].auto_action).toBeNull();
    expect(recipes[0].escalation).toBe('warn_only');
    expect(recipes[0].steps).toEqual([{ action: 'suggest_rebase' }]);
  });

  it('returns auto_action = "reduce_autonomy" for repeated_failures signal', () => {
    const signals = [{ type: 'repeated_failures', severity: 'red', agent_id: 'agent-2' }];
    const recipes = evaluateRecoveryRecipes(signals);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].auto_action).toBe('reduce_autonomy');
    expect(recipes[0].escalation).toBe('alert_human');
  });

  it('returns empty array for unknown signal type', () => {
    const signals = [{ type: 'unknown_signal_xyz', severity: 'amber', agent_id: 'agent-1' }];
    const recipes = evaluateRecoveryRecipes(signals);
    expect(recipes).toEqual([]);
  });

  it('respects max_attempts — skips recipe when attempt count reached', () => {
    const signals = [{ type: 'branch_stale', severity: 'amber', agent_id: 'agent-1' }];
    const attemptLog = { branch_stale: { 'agent-1': 1 } };
    const recipes = evaluateRecoveryRecipes(signals, attemptLog);
    expect(recipes).toEqual([]);
  });

  it('returns recipe when attemptLog count is below max_attempts', () => {
    const signals = [{ type: 'branch_stale', severity: 'amber', agent_id: 'agent-1' }];
    const attemptLog = { branch_stale: { 'agent-1': 0 } };
    const recipes = evaluateRecoveryRecipes(signals, attemptLog);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].signal).toBe('branch_stale');
  });

  it('handles multiple signals returning multiple recipes', () => {
    const signals = [
      { type: 'session_stalled', severity: 'red', agent_id: 'a1' },
      { type: 'mcp_degraded', severity: 'amber', agent_id: 'a2' },
    ];
    const recipes = evaluateRecoveryRecipes(signals);
    expect(recipes).toHaveLength(2);
    expect(recipes[0].signal).toBe('session_stalled');
    expect(recipes[0].auto_action).toBe('restart_session');
    expect(recipes[1].signal).toBe('mcp_degraded');
    expect(recipes[1].auto_action).toBe('retry_mcp_handshake');
  });

  it('returns correct recipe for green_insufficient signal', () => {
    const signals = [{ type: 'green_insufficient', severity: 'red', agent_id: 'ci-agent' }];
    const recipes = evaluateRecoveryRecipes(signals);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].suggestion).toContain('Tests must pass');
    expect(recipes[0].auto_action).toBeNull();
    expect(recipes[0].escalation).toBe('block_until_resolved');
    expect(recipes[0].steps).toEqual([{ action: 'suggest_test_run', required_level: 'workspace' }]);
  });

  it('returns correct recipe for assumption_drift signal', () => {
    const signals = [{ type: 'assumption_drift', severity: 'amber', agent_id: 'drift-1' }];
    const recipes = evaluateRecoveryRecipes(signals);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].suggestion).toContain('assumptions');
    expect(recipes[0].auto_action).toBeNull();
    expect(recipes[0].escalation).toBe('warn_only');
  });

  it('skips only the exhausted signal and returns others', () => {
    const signals = [
      { type: 'branch_stale', severity: 'amber', agent_id: 'agent-1' },
      { type: 'session_stalled', severity: 'red', agent_id: 'agent-1' },
    ];
    const attemptLog = { branch_stale: { 'agent-1': 1 } };
    const recipes = evaluateRecoveryRecipes(signals, attemptLog);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].signal).toBe('session_stalled');
  });

  it('defaults attemptLog to empty object when omitted', () => {
    const signals = [{ type: 'session_stalled', severity: 'red', agent_id: 'x' }];
    const recipes = evaluateRecoveryRecipes(signals);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].signal).toBe('session_stalled');
  });
});
