import { describe, it, expect } from 'vitest';
import {
  KINDS,
  detectForSession,
  detectCacheCrater,
  digestMarkdown,
  resolveScope,
} from '@/lib/claude-code/alerts.js';

describe('claude-code/alerts', () => {
  it('cost_anomaly fires when session cost >= 3x project median', () => {
    const priorSessions = [{ cost_usd: 1 }, { cost_usd: 1 }, { cost_usd: 1 }, { cost_usd: 1 }, { cost_usd: 1 }];
    const alerts = detectForSession({
      session: { session_uuid: 'big', cost_usd: 4 },
      priorSessions,
      stuckLoopCount: 0,
    });
    expect(alerts.find(a => a.kind === KINDS.COST_ANOMALY)).toBeTruthy();
  });

  it('cost_anomaly does NOT fire on near-miss (just under 3x)', () => {
    const priorSessions = [{ cost_usd: 1 }, { cost_usd: 1 }, { cost_usd: 1 }, { cost_usd: 1 }, { cost_usd: 1 }];
    const alerts = detectForSession({
      session: { session_uuid: 'mid', cost_usd: 2.99 },
      priorSessions,
    });
    expect(alerts.find(a => a.kind === KINDS.COST_ANOMALY)).toBeUndefined();
  });

  it('cost_anomaly does not fire with insufficient history (<5)', () => {
    const priorSessions = [{ cost_usd: 1 }, { cost_usd: 1 }];
    const alerts = detectForSession({ session: { cost_usd: 10 }, priorSessions });
    expect(alerts.find(a => a.kind === KINDS.COST_ANOMALY)).toBeUndefined();
  });

  it('stuck_loop_streak fires at >2 (i.e. 3+) loops, not at 2', () => {
    const a2 = detectForSession({ session: { cost_usd: 1 }, priorSessions: [], stuckLoopCount: 2 });
    const a3 = detectForSession({ session: { cost_usd: 1 }, priorSessions: [], stuckLoopCount: 3 });
    expect(a2.find(a => a.kind === KINDS.STUCK_LOOP_STREAK)).toBeUndefined();
    expect(a3.find(a => a.kind === KINDS.STUCK_LOOP_STREAK)).toBeTruthy();
  });

  it('multi_project_usage fires when projectSessionCount >= 3, not 2', () => {
    const a2 = detectForSession({ session: { cost_usd: 1 }, priorSessions: [], projectSessionCount: 2 });
    const a3 = detectForSession({ session: { cost_usd: 1 }, priorSessions: [], projectSessionCount: 3 });
    expect(a2.find(a => a.kind === KINDS.MULTI_PROJECT_USAGE)).toBeUndefined();
    expect(a3.find(a => a.kind === KINDS.MULTI_PROJECT_USAGE)).toBeTruthy();
  });

  it('cache_crater fires on >20pp drop and not on <=20pp drop', () => {
    const prior = { input_tokens: 100, cache_read_tokens: 9000, cache_creation_tokens: 100 };
    const big = { input_tokens: 5000, cache_read_tokens: 1000, cache_creation_tokens: 5000 };
    const small = { input_tokens: 100, cache_read_tokens: 7500, cache_creation_tokens: 100 };
    const hit = detectCacheCrater({ thisWeek: big, priorWeek: prior, project: { slug: 'demo' } });
    const miss = detectCacheCrater({ thisWeek: small, priorWeek: prior, project: { slug: 'demo' } });
    expect(hit).toBeTruthy();
    expect(hit.kind).toBe(KINDS.CACHE_CRATER);
    expect(miss).toBe(null);
  });

  it('detectForSession tags scope: multi_project_usage=org, others=session', () => {
    const alerts = detectForSession({
      session: { session_uuid: 'big', cost_usd: 10 },
      priorSessions: [{ cost_usd: 1 }, { cost_usd: 1 }, { cost_usd: 1 }, { cost_usd: 1 }, { cost_usd: 1 }],
      stuckLoopCount: 4,
      projectSessionCount: 5,
    });
    const multi = alerts.find(a => a.kind === KINDS.MULTI_PROJECT_USAGE);
    const stuck = alerts.find(a => a.kind === KINDS.STUCK_LOOP_STREAK);
    const cost = alerts.find(a => a.kind === KINDS.COST_ANOMALY);
    expect(multi.scope).toBe('org');
    expect(stuck.scope).toBe('session');
    expect(cost.scope).toBe('session');
  });

  it('resolveScope strips session/project when scope is org or user', () => {
    expect(resolveScope({ scope: 'org' }, { project_id: 5, session_id: 7 }))
      .toEqual({ project_id: null, session_id: null });
    expect(resolveScope({ scope: 'user' }, { project_id: 5, session_id: 7 }))
      .toEqual({ project_id: null, session_id: null });
    expect(resolveScope({ scope: 'project' }, { project_id: 5, session_id: 7 }))
      .toEqual({ project_id: 5, session_id: null });
    expect(resolveScope({ scope: 'session' }, { project_id: 5, session_id: 7 }))
      .toEqual({ project_id: 5, session_id: 7 });
    expect(resolveScope({}, { project_id: 5, session_id: 7 }))
      .toEqual({ project_id: 5, session_id: 7 });
  });

  it('digestMarkdown groups by kind and handles empty', () => {
    expect(digestMarkdown([])).toMatch(/No alerts in the last 24h/);
    const md = digestMarkdown([
      { kind: KINDS.COST_ANOMALY, title: 'X', body: 'b' },
      { kind: KINDS.COST_ANOMALY, title: 'Y', body: 'b' },
      { kind: KINDS.MULTI_PROJECT_USAGE, title: 'Z', body: 'b' },
    ]);
    expect(md).toMatch(/Cost anomalies/);
    expect(md).toMatch(/Multi-project usage/);
  });
});
