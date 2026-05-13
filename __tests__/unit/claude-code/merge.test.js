import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseMarkdownSections,
  normalizeHeading,
  parseBullets,
  bulletAlreadyPresent,
  previewMerge,
  applyMerge,
} from '@/lib/claude-code/optimal-files/merge.js';
import {
  planBundleSelections,
  previewBundleMerge,
  sideBySidePath,
} from '@/lib/claude-code/optimal-files/bundle.js';
import { applyBundlePlan } from '@/lib/claude-code/optimal-files/apply.js';

function tmpDir(label) {
  const p = path.join(os.tmpdir(), `dashclaw-merge-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function existingPathsIn(dir) {
  const set = new Set();
  function walk(d) {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isFile()) set.add(p);
      else if (e.isDirectory()) walk(p);
    }
  }
  walk(dir);
  return set;
}

describe('claude-code/optimal-files/merge — pure markdown logic', () => {
  it('parseMarkdownSections splits on H2 and preserves preamble', () => {
    const text = '# Title\nintro line\n\n## A\nalpha\n## B\nbeta\n';
    const sections = parseMarkdownSections(text);
    expect(sections.length).toBe(4);
    expect(sections[0].heading).toBe('__preamble__');
    expect(sections[1].heading).toBe('title');
    expect(sections[2].heading).toBe('a');
    expect(sections[3].heading).toBe('b');
  });

  it('normalizeHeading is case- and punctuation-insensitive', () => {
    expect(normalizeHeading('Fast Start!')).toBe('fast start');
    expect(normalizeHeading('`Working` Rules')).toBe('working rules');
    expect(normalizeHeading('Repeated tool-run signals')).toBe('repeated tool run signals');
  });

  it('bulletAlreadyPresent recognizes prefix overlap and reworded near-matches', () => {
    const existing = parseBullets([
      '- Validate inputs before database writes',
      '- Auth-gate every state-mutating route',
    ]).bullets;
    expect(bulletAlreadyPresent('validate inputs before database writes', existing)).toBe(true);
    expect(bulletAlreadyPresent('validate inputs before database writes always', existing)).toBe(true);
    expect(bulletAlreadyPresent('return structured json errors not stack traces', existing)).toBe(false);
  });

  it('previewMerge splits append-sections from shared-section candidates', () => {
    const existing = `# My CLAUDE.md

## Project
hand-written project intro.

## Working rules
- Validate inputs before database writes.
- Auth-gate every state-mutating route.
`;
    const generated = `# CLAUDE.md

## Project
generated intro that we DON'T want to silently replace the hand-written one.

## Fast start
- Install: \`npm install\`
- Test: \`npm test\`

## Working rules
- Validate inputs before database writes.
- Return structured JSON errors — never leak stack traces to clients.
- Run \`npm test\` after route changes.

## Architecture map
- src/ source code
`;
    const plan = previewMerge(existing, generated);
    const newHeadings = plan.appendSections.map(s => s.heading);
    expect(new Set(newHeadings)).toEqual(new Set(['fast start', 'architecture map']));
    const wr = plan.sharedSections.find(s => s.heading === 'working rules');
    expect(wr).toBeTruthy();
    const candidateTexts = wr.candidateBullets.map(b => b.text.toLowerCase());
    expect(candidateTexts.some(t => t.includes('structured json errors'))).toBe(true);
    expect(candidateTexts.some(t => t.includes('npm test'))).toBe(true);
    expect(candidateTexts.some(t => t.includes('validate inputs'))).toBe(false);
    expect(plan.sharedSections.find(s => s.heading === 'project')).toBeUndefined();
  });

  it('applyMerge appends accepted sections inside a marker block and preserves existing text', () => {
    const existing = `# My CLAUDE.md\n\n## Project\nhand-written intro.\n`;
    const generated = `# CLAUDE.md\n\n## Fast start\n- npm install\n- npm test\n\n## Architecture map\n- src/ source code\n`;
    const plan = previewMerge(existing, generated);
    const apply = applyMerge(existing, generated, {
      acceptedHeadings: plan.appendSections.map(s => s.heading),
      acceptedBullets: [],
    });
    expect(apply.merged).toMatch(/hand-written intro/);
    expect(apply.merged).toMatch(/<!-- dashclaw:merged-sections -->/);
    expect(apply.merged).toMatch(/## Fast start/);
    expect(apply.merged).toMatch(/## Architecture map/);
    expect(apply.additions.sections.length).toBe(2);
    expect(apply.additions.bulletCount).toBe(0);
  });

  it('applyMerge appends accepted bullets within shared section under a marker', () => {
    const existing = `## Working rules\n- Validate inputs before database writes.\n`;
    const generated = `## Working rules\n- Validate inputs before database writes.\n- Return structured JSON errors.\n- Run \`npm test\` after route changes.\n`;
    const plan = previewMerge(existing, generated);
    const wr = plan.sharedSections.find(s => s.heading === 'working rules');
    const apply = applyMerge(existing, generated, {
      acceptedHeadings: [],
      acceptedBullets: wr.candidateBullets.map(b => ({ heading: 'working rules', text: b.text })),
    });
    expect(apply.merged).toMatch(/Validate inputs before database writes/);
    expect(apply.merged).toMatch(/Return structured JSON errors/);
    expect(apply.merged).toMatch(/Run `npm test` after route changes/);
    expect(apply.merged).toMatch(/<!-- dashclaw:merged-bullets -->/);
    expect(apply.additions.bulletCount).toBe(2);
  });

  it('applyMerge with no selections is a no-op on the existing content', () => {
    const existing = `## A\n- x\n`;
    const generated = `## A\n- x\n- y\n\n## B\n- z\n`;
    const apply = applyMerge(existing, generated, { acceptedHeadings: [], acceptedBullets: [] });
    expect(apply.merged.trim()).toBe(existing.trim());
    expect(apply.additions.bulletCount).toBe(0);
    expect(apply.additions.sections.length).toBe(0);
  });

  it('previewMerge ignores provenance footer of generated content', () => {
    const existing = `## Project\nhi.\n`;
    const generated = `## Project\nhi.\n\n---\nGenerated by DashClaw Code Sessions from session abc.\nReview before committing.\n`;
    const plan = previewMerge(existing, generated);
    expect(plan.appendSections.length).toBe(0);
  });
});

describe('claude-code/optimal-files/bundle — plan + apply round-trip', () => {
  it('planBundleSelections + applyBundlePlan: conflict on existing file without overwrite, then overwrite succeeds', () => {
    const cwd = tmpDir('twice');
    try {
      fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), '# existing\n');
      const bundle = [{
        path: 'CLAUDE.md',
        content: '# generated\n',
        kind: 'root-claude-md', group: 'recommended_now', confidence: 'high',
      }];
      // First call — conflict (no overwrite).
      let plan = planBundleSelections({
        bundle, projectCwd: cwd,
        selections: [{ path: 'CLAUDE.md' }],
        existingPaths: existingPathsIn(cwd),
      });
      expect(plan.results[0].status).toBe('conflict');
      // No write happened.
      expect(fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')).toBe('# existing\n');
      // Plan again, with overwrite — status becomes overwrite_planned.
      plan = planBundleSelections({
        bundle, projectCwd: cwd,
        selections: [{ path: 'CLAUDE.md', overwrite: true }],
        existingPaths: existingPathsIn(cwd),
      });
      expect(plan.results[0].status).toBe('overwrite_planned');
      // Apply the plan: file is rewritten.
      const apply = applyBundlePlan({ plan: plan.results, projectCwd: cwd });
      expect(apply.results[0].status).toBe('overwritten');
      expect(fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')).toBe('# generated\n');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('mode=merge applies markdown merge to existing file (plan + apply)', () => {
    const cwd = tmpDir('merge');
    try {
      const existingMd = `# My CLAUDE.md\n\n## Project\nhand-written intro.\n`;
      fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), existingMd);
      const bundle = [{
        path: 'CLAUDE.md',
        content: `# CLAUDE.md\n\n## Fast start\n- npm install\n- npm test\n\n## Working rules\n- Be careful.\n`,
        kind: 'root-claude-md',
        group: 'recommended_now',
        confidence: 'high',
      }];
      const mergeContent = new Map([[path.join(cwd, 'CLAUDE.md'), existingMd]]);
      const plan = planBundleSelections({
        bundle, projectCwd: cwd,
        selections: [{
          path: 'CLAUDE.md',
          mode: 'merge',
          acceptedHeadings: ['fast start', 'working rules'],
          acceptedBullets: [],
        }],
        existingPaths: existingPathsIn(cwd),
        mergeContent,
      });
      expect(plan.results[0].status).toBe('merge_planned');
      const apply = applyBundlePlan({ plan: plan.results, projectCwd: cwd });
      expect(apply.results[0].status).toBe('merged');
      const after = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8');
      expect(after).toMatch(/hand-written intro/);
      expect(after).toMatch(/## Fast start/);
      expect(after).toMatch(/## Working rules/);
      expect(after).toMatch(/<!-- dashclaw:merged-sections -->/);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('mode=merge on a Python hook falls back to side-by-side at plan time', () => {
    const cwd = tmpDir('merge-py');
    try {
      const original = '#!/usr/bin/env python3\nprint("hand-written guard")\n';
      fs.mkdirSync(path.join(cwd, '.claude', 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.claude', 'hooks', 'guard.py'), original);
      const bundle = [{
        path: '.claude/hooks/guard.py',
        content: '#!/usr/bin/env python3\nprint("DashClaw generated guard")\n',
        kind: 'hook-stuck-loop', group: 'optional', confidence: 'medium',
      }];
      const plan = planBundleSelections({
        bundle, projectCwd: cwd,
        selections: [{ path: '.claude/hooks/guard.py', mode: 'merge' }],
        existingPaths: existingPathsIn(cwd),
      });
      expect(plan.results[0].status).toBe('side_by_side_fallback');
      const apply = applyBundlePlan({ plan: plan.results, projectCwd: cwd });
      expect(apply.results[0].status).toBe('side_by_side');
      expect(fs.readFileSync(path.join(cwd, '.claude', 'hooks', 'guard.py'), 'utf8')).toBe(original);
      expect(fs.existsSync(path.join(cwd, '.claude', 'hooks', 'guard.NEW.py'))).toBe(true);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('mode=side_by_side refuses to clobber existing .NEW without allowOverwriteSideBySide', () => {
    const cwd = tmpDir('sbs');
    try {
      fs.mkdirSync(path.join(cwd, '.claude', 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.claude', 'hooks', 'g.py'), 'orig\n');
      fs.writeFileSync(path.join(cwd, '.claude', 'hooks', 'g.NEW.py'), 'stale .NEW\n');
      const bundle = [{
        path: '.claude/hooks/g.py',
        content: 'fresh\n', kind: 'hook', group: 'optional', confidence: 'low',
      }];
      const plan = planBundleSelections({
        bundle, projectCwd: cwd,
        selections: [{ path: '.claude/hooks/g.py', mode: 'side_by_side' }],
        existingPaths: existingPathsIn(cwd),
      });
      expect(plan.results[0].status).toBe('side_by_side');
      const apply = applyBundlePlan({ plan: plan.results, projectCwd: cwd });
      expect(apply.results[0].status).toBe('side_by_side_conflict');
      expect(fs.readFileSync(path.join(cwd, '.claude', 'hooks', 'g.NEW.py'), 'utf8')).toBe('stale .NEW\n');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('sideBySidePath inserts .NEW before the extension', () => {
    expect(sideBySidePath('/a/b/CLAUDE.md')).toBe(path.normalize('/a/b/CLAUDE.NEW.md'));
    expect(sideBySidePath('/a/b/file')).toBe(path.normalize('/a/b/file.NEW'));
    expect(sideBySidePath('/a/b/guard.py')).toBe(path.normalize('/a/b/guard.NEW.py'));
  });

  it('previewBundleMerge surfaces side_by_side_only for non-markdown', () => {
    const cwd = tmpDir('preview-nonmd');
    try {
      const bundle = [{ path: '.claude/hooks/g.py', content: 'new', kind: 'hook', group: 'optional', confidence: 'low' }];
      const r = previewBundleMerge({ bundle, projectCwd: cwd, filePath: '.claude/hooks/g.py', existingContent: 'orig\n' });
      expect(r.mode).toBe('side_by_side_only');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('previewBundleMerge returns no_existing_supplied when caller passes null content', () => {
    const cwd = tmpDir('preview-none');
    try {
      const bundle = [{ path: 'CLAUDE.md', content: '## A\n', kind: 'root-claude-md', group: 'recommended_now', confidence: 'high' }];
      const r = previewBundleMerge({ bundle, projectCwd: cwd, filePath: 'CLAUDE.md', existingContent: null });
      expect(r.mode).toBe('no_existing_supplied');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('previewBundleMerge returns merge_available plan and a fullAcceptance preview', () => {
    const cwd = tmpDir('preview-md');
    try {
      const bundle = [{
        path: 'CLAUDE.md',
        content: '## Project\nhi.\n\n## Fast start\n- npm test\n',
        kind: 'root-claude-md', group: 'recommended_now', confidence: 'high',
      }];
      const r = previewBundleMerge({
        bundle, projectCwd: cwd, filePath: 'CLAUDE.md',
        existingContent: '## Project\nhi.\n',
      });
      expect(r.mode).toBe('merge_available');
      expect(r.plan.newSectionCount).toBe(1);
      expect(r.fullAcceptance.preview.includes('## Fast start')).toBe(true);
      expect(r.fullAcceptance.preview.includes('## Project')).toBe(true);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
