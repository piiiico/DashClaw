import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExecuteCompletion } = vi.hoisted(() => ({
  mockExecuteCompletion: vi.fn(),
}));

vi.mock('@/lib/providers.js', () => ({
  executeCompletion: mockExecuteCompletion,
}));

import {
  computeStatisticalAdjustment,
  assessRiskWithLLM,
  getPredictiveRisk,
} from '@/lib/predictive-risk.js';
import { createSqlMock } from '../helpers.js';

describe('predictive-risk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('computeStatisticalAdjustment', () => {
    it('returns +15 for >50% failure rate', () => {
      const stats = { total: 10, failures: 6, avg_risk: 50, recent_count: 1 };
      const adj = computeStatisticalAdjustment(stats);
      expect(adj.adjustment).toBe(15);
    });

    it('returns +10 for 25-50% failure rate', () => {
      const stats = { total: 10, failures: 3, avg_risk: 50, recent_count: 1 };
      const adj = computeStatisticalAdjustment(stats);
      expect(adj.adjustment).toBe(10);
    });

    it('returns +5 for velocity spike (>5 actions in last hour)', () => {
      const stats = { total: 20, failures: 1, avg_risk: 30, recent_count: 8 };
      const adj = computeStatisticalAdjustment(stats);
      expect(adj.adjustment).toBe(5);
    });

    it('returns +5 for zero history (unknown territory) flagged basis=no_history', () => {
      const stats = { total: 0, failures: 0, avg_risk: null, recent_count: 0 };
      const adj = computeStatisticalAdjustment(stats);
      expect(adj.adjustment).toBe(5);
      expect(adj.basis).toBe('no_history');
    });

    it('returns 0 for healthy agent with low failure rate', () => {
      const stats = { total: 50, failures: 2, avg_risk: 30, recent_count: 2 };
      const adj = computeStatisticalAdjustment(stats);
      expect(adj.adjustment).toBe(0);
      expect(adj.basis).toBe('history');
    });

    it('stacks failure rate and velocity adjustments', () => {
      const stats = { total: 10, failures: 6, avg_risk: 70, recent_count: 8 };
      const adj = computeStatisticalAdjustment(stats);
      expect(adj.adjustment).toBe(20);
    });
  });

  describe('assessRiskWithLLM', () => {
    it('returns adjustment and reasoning from LLM', async () => {
      mockExecuteCompletion.mockResolvedValue({
        content: JSON.stringify({ adjustment: 12, reasoning: 'High failure rate after hours' }),
        provider: 'openai',
        model: 'gpt-4o-mini',
        usage: { input_tokens: 300, output_tokens: 50 },
        cost_usd: 0.001,
      });

      const sql = createSqlMock({
        taggedResponses: [
          [
            { action_type: 'deploy', status: 'failed', risk_score: 70, created_at: '2026-04-07T01:00:00Z' },
            { action_type: 'deploy', status: 'completed', risk_score: 50, created_at: '2026-04-07T00:00:00Z' },
          ],
          [{ key: 'OPENAI_API_KEY', value: 'sk-test', encrypted: false }],
        ],
      });

      const result = await assessRiskWithLLM(sql, 'org_1', 'agent-1', 'deploy');
      expect(result.adjustment).toBe(12);
      expect(result.reasoning).toBe('High failure rate after hours');
      expect(mockExecuteCompletion.mock.calls[0][2]).toEqual({
        primary: { provider: 'openai', model: 'gpt-4.1-mini' },
        fallback: [{ provider: 'anthropic', model: 'claude-haiku-4-5' }],
        maxRetries: 1,
        maxBudgetUsd: 0.05,
      });
    });

    it('clamps adjustment to [-20, +20]', async () => {
      mockExecuteCompletion.mockResolvedValue({
        content: JSON.stringify({ adjustment: 50, reasoning: 'Very risky' }),
        provider: 'openai',
        model: 'gpt-4o-mini',
        usage: { input_tokens: 300, output_tokens: 50 },
        cost_usd: 0.001,
      });

      const sql = createSqlMock({
        taggedResponses: [
          [{ action_type: 'deploy', status: 'failed', risk_score: 70, created_at: '2026-04-07T01:00:00Z' }],
          [{ key: 'OPENAI_API_KEY', value: 'sk-test', encrypted: false }],
        ],
      });

      const result = await assessRiskWithLLM(sql, 'org_1', 'agent-1', 'deploy');
      expect(result.adjustment).toBe(20);
    });

    it('returns null on LLM failure (fail-open)', async () => {
      mockExecuteCompletion.mockRejectedValue(new Error('Provider timeout'));

      const sql = createSqlMock({
        taggedResponses: [
          [{ action_type: 'deploy', status: 'failed', risk_score: 70, created_at: '2026-04-07T01:00:00Z' }],
          [{ key: 'OPENAI_API_KEY', value: 'sk-test', encrypted: false }],
        ],
      });

      const result = await assessRiskWithLLM(sql, 'org_1', 'agent-1', 'deploy');
      expect(result).toBeNull();
    });
  });

  describe('getPredictiveRisk', () => {
    it('returns statistical-only when score is below threshold', async () => {
      const sql = createSqlMock({
        queryResponses: [
          [{ total: '20', failures: '2', avg_risk: '30', recent_count: '1' }],
        ],
      });

      const result = await getPredictiveRisk(sql, 'org_1', 'agent-1', 'test', 30, { enabled: true, threshold: 60 });
      expect(result.statistical).toBeDefined();
      expect(result.llm).toBeNull();
    });
  });
});
