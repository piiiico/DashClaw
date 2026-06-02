import { describe, it, expect } from 'vitest';
import { classifyTask, HEAVY_TASK_CLASSES } from '@/lib/behavior/task-classifier.js';
import { modelTier, tierRank, isBelowTier } from '@/lib/behavior/model-tier.js';

describe('behavior/task-classifier', () => {
  it('classifies schema migration work as the heavy "migration" class', () => {
    const r = classifyTask({ text: 'apply the drizzle schema migration', action_type: 'migrate', writePaths: ['drizzle/0015_x.sql'] });
    expect(r.task_class).toBe('migration');
    expect(r.heavy).toBe(true);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('classifies security review work as heavy', () => {
    const r = classifyTask({ text: 'audit auth for SSRF and injection vulnerabilities', writePaths: ['app/api/auth/route.js'] });
    expect(r.task_class).toBe('security_review');
    expect(HEAVY_TASK_CLASSES).toContain(r.task_class);
  });

  it('classifies repo-wide refactor as heavy and amplifies with many files', () => {
    const r = classifyTask({ text: 'refactor and restructure the module', action_type: 'refactor', writePaths: ['a.js', 'b.js', 'c.js', 'd.js', 'e.js'] });
    expect(r.task_class).toBe('refactor');
    expect(r.heavy).toBe(true);
  });

  it('classifies trivial work as a non-heavy class', () => {
    const r = classifyTask({ text: 'list files', action_type: 'review', tool: 'LS' });
    expect(r.heavy).toBe(false);
  });

  it('returns "other" with zero confidence when no signal matches', () => {
    const r = classifyTask({ text: 'xyzzy', action_type: 'other' });
    expect(r.task_class).toBe('other');
    expect(r.confidence).toBe(0);
  });

  it('is deterministic for the same input', () => {
    const ctx = { text: 'refactor the auth module', action_type: 'refactor' };
    expect(classifyTask(ctx)).toEqual(classifyTask(ctx));
  });
});

describe('behavior/model-tier', () => {
  it('classifies known models into tiers', () => {
    expect(modelTier('claude-opus-4-8')).toBe('frontier');
    expect(modelTier('claude-opus-4-8[1m]')).toBe('frontier');
    expect(modelTier('claude-sonnet-4-6')).toBe('mid');
    expect(modelTier('claude-haiku-4-5')).toBe('cheap');
    expect(modelTier('gpt-4o-mini')).toBe('cheap');
  });

  it('returns unknown for unrecognized models (never flagged)', () => {
    expect(modelTier('some-random-model')).toBe('unknown');
    expect(tierRank('some-random-model')).toBe(0);
    expect(isBelowTier('some-random-model', 'mid')).toBe(false);
  });

  it('isBelowTier: cheap is below mid, frontier is not', () => {
    expect(isBelowTier('claude-haiku-4-5', 'mid')).toBe(true);
    expect(isBelowTier('claude-sonnet-4-6', 'mid')).toBe(false);
    expect(isBelowTier('claude-opus-4-8', 'frontier')).toBe(false);
  });
});
