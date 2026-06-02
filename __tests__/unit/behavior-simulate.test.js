import { describe, it, expect } from 'vitest';
import { simulateBehaviorPolicy } from '@/lib/behavior/simulate.js';
import { RULE_KINDS } from '@/lib/behavior/policy-model.js';

const s = (over) => ({ event_id: 'e', ts: '2026-06-01T10:00:00Z', agent_id: 'a', tool: 'Bash', ...over });

describe('behavior/simulate', () => {
  it('counts require_approval vs allow for a destructive rule and flags completed-as-FP', () => {
    const samples = [
      s({ event_id: 'd1', risk_score: 90, outcome_status: 'completed' }),
      s({ event_id: 'd2', risk_score: 85, outcome_status: 'completed' }),
      s({ event_id: 'd3', risk_score: 95, outcome_status: 'failed' }),
      s({ event_id: 'a1', risk_score: 10, outcome_status: 'completed' }),
      s({ event_id: 'a2', risk_score: 20, outcome_status: 'completed' }),
    ];
    const rule = { kind: RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL, action: 'require_approval', risk_threshold: 70 };
    const out = simulateBehaviorPolicy(rule, samples);
    expect(out.total).toBe(5);
    expect(out.require_approval).toBe(3);
    expect(out.allow).toBe(2);
    expect(out.flagged).toBe(3);
    // d1 + d2 completed successfully → likely false positives; d3 failed → not counted.
    expect(out.likely_false_positives).toBe(2);
    expect(out.examples.length).toBeGreaterThan(0);
  });

  it('counts warns for a protected_path rule', () => {
    const samples = [
      s({ event_id: 'w1', tool: 'Write', write_paths: ['app/api/auth/route.js'], outcome_status: 'completed' }),
      s({ event_id: 'w2', tool: 'Write', write_paths: ['app/page.js'], outcome_status: 'completed' }),
    ];
    const rule = { kind: RULE_KINDS.PROTECTED_PATH_APPROVAL, action: 'warn', paths: ['**/auth/**'] };
    const out = simulateBehaviorPolicy(rule, samples);
    expect(out.warn).toBe(1);
    expect(out.allow).toBe(1);
  });

  it('reports allowlist coverage', () => {
    const samples = [
      s({ event_id: 'r1', tool: 'Read' }),
      s({ event_id: 'r2', tool: 'Read' }),
      s({ event_id: 'b1', tool: 'Bash', command_shape: 'rm -rf <path>' }),
    ];
    const rule = { kind: RULE_KINDS.AGENT_ALLOWLIST, action: 'allow', allow: { tools: ['Read'], action_types: [], command_verbs: [] } };
    const out = simulateBehaviorPolicy(rule, samples);
    expect(out.allow).toBe(3);
    expect(out.allowlist_covered).toBe(2);
  });
});
