/**
 * Optimizer runner — rule-set agnostic. Each rule returns Finding|null.
 *
 * Ported from AgentLens (`src/optimizer.js`). The original
 * `buildSessionContext(db, session)` helper is dropped — that lived in
 * AgentLens because it queried sqlite. The DashClaw equivalent is a
 * route-layer helper in `app/lib/repositories/code-sessions.repository.js`
 * (added in Phase 2) that assembles the same context shape from Postgres
 * tagged-template queries.
 *
 * Expected context shape:
 *   {
 *     session,              // session row
 *     stuckLoops,           // HIGH-confidence repeated runs only
 *     repeatedRuns,         // full set (all confidences)
 *     toolCount,            // total tool_use events
 *     toolEvents,           // [{name, requestId?, target?}, ...]
 *     subagentInvocations,  // [{name, parentTool?, prefixTokens?, prefix?}, ...]
 *     projectSessions,      // chronological project window (oldest first)
 *   }
 */

import { ALL_RULES } from './rules/index.js';

export function runOptimizer(context) {
  const findings = [];
  for (const rule of ALL_RULES) {
    try {
      const out = rule.inspect(context);
      if (out) findings.push(out);
    } catch (err) {
      // Rules are best-effort. Never fail the whole report on a single bug.
      findings.push({
        ruleId: rule.id,
        severity: 'error',
        title: `Rule ${rule.id} failed`,
        description: `Internal error: ${err && err.message ? err.message : String(err)}`,
        suggestedAction: null,
        estimatedMonthlySavingsUsd: null,
        evidence: null,
      });
    }
  }
  return findings;
}

export function totalEstimatedMonthlySavings(findings) {
  return findings.reduce((acc, f) => acc + (Number(f.estimatedMonthlySavingsUsd) || 0), 0);
}
