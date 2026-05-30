import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scanForSecrets } from '@/lib/claude-code/optimal-files/secret-scan.js';
import { analyzeSession } from '@/lib/claude-code/optimal-files/analyze.js';
import { generateRootClaudeMd, MAX_LINES_HARD } from '@/lib/claude-code/optimal-files/root-claude-md.js';
import { generateSessionPack } from '@/lib/claude-code/optimal-files/session-pack.js';
import { generatePathRules } from '@/lib/claude-code/optimal-files/path-rules.js';
import { generateHooksBundle } from '@/lib/claude-code/optimal-files/hooks-bundle.js';
import { generateRecipe } from '@/lib/claude-code/optimal-files/recipe.js';
import { generateSkillCandidates } from '@/lib/claude-code/optimal-files/skills.js';
import {
  buildOptimalFilesBundle,
  planBundleSelections,
  absolutize,
} from '@/lib/claude-code/optimal-files/bundle.js';
import { applyBundlePlan, listGeneratedFiles } from '@/lib/claude-code/optimal-files/apply.js';

function tmpDir(label) {
  const p = path.join(os.tmpdir(), `dashclaw-optimal-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function buildFixture({ tools = [], packageJson = null, files = {} } = {}) {
  const cwd = tmpDir('fix');
  const projectFiles = new Map();
  if (packageJson) {
    const content = JSON.stringify(packageJson, null, 2);
    fs.writeFileSync(path.join(cwd, 'package.json'), content);
    projectFiles.set('package.json', content);
  }
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    projectFiles.set(rel, content);
  }
  return {
    cwd,
    projectFiles,
    session: {
      id: 1,
      session_uuid: 'fix-uuid-1',
      project_id: 1,
      cost_usd: 5.0,
      naive_cost_usd: 9.0,
      parser_version: 2,
      model_primary: 'claude-opus-4-7',
      source_file: '/tmp/fake.jsonl',
    },
    project: { id: 1, slug: 'demo', cwd },
    toolEvents: tools,
  };
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

describe('claude-code/optimal-files', () => {
  it('scanForSecrets returns passed when nothing matches', () => {
    const r = scanForSecrets('# plain content\nconst x = 1;\n');
    expect(r.status).toBe('passed');
    expect(r.redactions).toBe(0);
    expect(r.redacted).toMatch(/plain content/);
  });

  it('scanForSecrets redacts known patterns and counts them', () => {
    const input = `
STRIPE_KEY=sk_test_AbCdEfGhIjKlMnOpQrSt12345
webhook=whsec_abcdefghij1234567890
github_token: ghp_aaaaaaaaaaaaaaaaaaaaaaaa1234567890ab
note: not a secret
`;
    const r = scanForSecrets(input);
    expect(r.status).toBe('redacted');
    expect(r.redactions).toBeGreaterThanOrEqual(3);
    expect(r.redacted).not.toMatch(/sk_test_AbCdEfGhIjKlMnOpQrSt12345/);
  });

  it('analyzeSession surfaces heavy reads, edits, verification, dangerous, and repeated runs', () => {
    const fix = buildFixture({
      tools: [
        { name: 'Read', target: 'src/db.js' },
        { name: 'Read', target: 'src/db.js' },
        { name: 'Read', target: 'src/db.js' },
        { name: 'Edit', target: 'src/db.js' },
        { name: 'Bash', target: 'npm test' },
        { name: 'Bash', target: 'rm -rf /tmp/stuff/*' },
        { name: 'Read', target: 'src/routes/x.js' },
        { name: 'Read', target: 'src/routes/x.js' },
        { name: 'Read', target: 'src/routes/x.js' },
        { name: 'Read', target: 'src/routes/x.js' },
        { name: 'Read', target: 'src/routes/x.js' },
      ],
    });
    const a = analyzeSession({ ...fix, projectFiles: fix.projectFiles });
    expect(a.reads[0].target).toBe('src/routes/x.js');
    expect(a.reads[0].count).toBe(5);
    expect(a.edits.length).toBeGreaterThanOrEqual(1);
    expect(a.verificationCommands.find(v => v.command === 'npm test')).toBeTruthy();
    expect(a.dangerousCommands.length).toBeGreaterThanOrEqual(1);
    expect(a.dangerousCommands[0].why).toBe('rm -rf at filesystem root or home');
    expect(a.repeatedRunSummary.high + a.repeatedRunSummary.medium + a.repeatedRunSummary.low).toBe(a.repeatedRuns.length);
    fs.rmSync(fix.cwd, { recursive: true, force: true });
  });

  it('generateRootClaudeMd is concise, includes fast-start commands, and stays under hard cap', () => {
    const fix = buildFixture({
      tools: [
        { name: 'Read', target: 'src/index.js' },
        { name: 'Read', target: 'src/index.js' },
        { name: 'Read', target: 'src/index.js' },
        { name: 'Bash', target: 'npm test' },
      ],
      packageJson: {
        name: 'demo', description: 'demo project', version: '1.0.0',
        scripts: { test: 'node --test', start: 'node src/index.js' },
      },
    });
    const a = analyzeSession({ ...fix, projectFiles: fix.projectFiles });
    const out = generateRootClaudeMd(a);
    expect(out.kind).toBe('root-claude-md');
    expect(out.path).toBe('CLAUDE.md');
    expect(out.content).toMatch(/## Fast start/);
    expect(out.content).toMatch(/npm test/);
    expect(out.content).toMatch(/Working rules/);
    expect(out.content).toMatch(/Deeper context/);
    expect(out.lineCount).toBeLessThanOrEqual(MAX_LINES_HARD);
    expect(out.content).toMatch(/Generated by DashClaw Code Sessions from session/);
    fs.rmSync(fix.cwd, { recursive: true, force: true });
  });

  it('root CLAUDE.md does not include any full prompt text or raw session dump', () => {
    const fix = buildFixture({ tools: [{ name: 'Read', target: 'src/a.js' }] });
    const a = analyzeSession({ ...fix, projectFiles: fix.projectFiles });
    const out = generateRootClaudeMd(a);
    expect(out.content).not.toMatch(/user prompt/i);
    expect(out.content).not.toMatch(/<details><summary>Excerpt/);
    fs.rmSync(fix.cwd, { recursive: true, force: true });
  });

  it('session pack records deduped cost and flags naive-vs-deduped when they differ', () => {
    const fix = buildFixture({ tools: [{ name: 'Read', target: 'src/a.js' }] });
    fix.session.cost_usd = 5;
    fix.session.naive_cost_usd = 9;
    const a = analyzeSession({ ...fix, projectFiles: fix.projectFiles });
    const out = generateSessionPack(a);
    expect(out.content).toMatch(/Naive row-sum would have been \$9\.00/);
    expect(out.content).toMatch(/Parser v2 rejected the duplicate fragments/);
    expect(out.content).toMatch(/Cost numbers above are deduped/);
    fs.rmSync(fix.cwd, { recursive: true, force: true });
  });

  it('session pack labels suggested prompt as a starting point, not the original', () => {
    const fix = buildFixture({
      tools: [
        { name: 'Read', target: 'src/a.js' },
        { name: 'Read', target: 'src/a.js' },
        { name: 'Bash', target: 'npm test' },
      ],
    });
    const a = analyzeSession({ ...fix, projectFiles: fix.projectFiles });
    const out = generateSessionPack(a);
    expect(out.content).toMatch(/Suggested starting prompt for the next session/);
    expect(out.content).toMatch(/Inferred from tool sequence/);
    fs.rmSync(fix.cwd, { recursive: true, force: true });
  });

  it('path-rules only generates files for scopes that were actually exercised', () => {
    const fix = buildFixture({
      tools: [
        { name: 'Read', target: 'src/routes/a.js' },
        { name: 'Read', target: 'src/routes/b.js' },
        { name: 'Edit', target: 'src/routes/c.js' },
        { name: 'Read', target: 'public/index.html' },
      ],
    });
    const a = analyzeSession({ ...fix, projectFiles: fix.projectFiles });
    const rules = generatePathRules(a);
    const kinds = rules.map(r => r.path);
    expect(kinds).toContain('.claude/rules/api.md');
    expect(kinds).not.toContain('.claude/rules/frontend.md');
    for (const r of rules) {
      expect(r.content).toMatch(/^---\npaths:\n/);
    }
    fs.rmSync(fix.cwd, { recursive: true, force: true });
  });

  it('analyzeSession catches rm -rf / at end-of-string (regression: trailing \\b was broken)', () => {
    const fix = buildFixture({ tools: [{ name: 'Bash', target: 'rm -rf /' }] });
    const a = analyzeSession({ ...fix, projectFiles: fix.projectFiles });
    expect(a.dangerousCommands.length).toBe(1);
    expect(a.dangerousCommands[0].command).toBe('rm -rf /');
    fs.rmSync(fix.cwd, { recursive: true, force: true });
  });

  it('hooks bundle emits dangerous-command guard ONLY when dangerous commands were observed', () => {
    const f1 = buildFixture({ tools: [{ name: 'Bash', target: 'rm -rf /tmp/junk/*' }] });
    const f2 = buildFixture({ tools: [{ name: 'Bash', target: 'echo hi' }] });
    const a1 = analyzeSession({ ...f1, projectFiles: f1.projectFiles });
    const a2 = analyzeSession({ ...f2, projectFiles: f2.projectFiles });
    const h1 = generateHooksBundle(a1);
    const h2 = generateHooksBundle(a2);
    expect(h1.find(f => f.kind === 'hook-dangerous-command')).toBeTruthy();
    expect(h2.find(f => f.kind === 'hook-dangerous-command')).toBeUndefined();
    expect(h1.find(f => f.kind === 'hook-secret-output')).toBeTruthy();
    expect(h2.find(f => f.kind === 'hook-secret-output')).toBeTruthy();
    fs.rmSync(f1.cwd, { recursive: true, force: true });
    fs.rmSync(f2.cwd, { recursive: true, force: true });
  });

  it('recipe includes a suggested starting prompt and verification gates', () => {
    const fix = buildFixture({
      tools: [
        { name: 'Read', target: 'src/a.js' },
        { name: 'Bash', target: 'npm test' },
      ],
    });
    const a = analyzeSession({ ...fix, projectFiles: fix.projectFiles });
    const out = generateRecipe(a);
    expect(out.path).toMatch(/^\.claude\/dashclaw\/recipes\//);
    expect(out.content).toMatch(/Recommended starting prompt/);
    expect(out.content).toMatch(/Verification gates/);
    expect(out.content).toMatch(/npm test/);
    fs.rmSync(fix.cwd, { recursive: true, force: true });
  });

  it('skill candidate is deferred when no similar sessions exist', () => {
    const fix = buildFixture({ tools: [{ name: 'Read', target: 'src/a.js' }] });
    const a = analyzeSession({ ...fix, projectFiles: fix.projectFiles, similarSessionCount: 0 });
    const skills = generateSkillCandidates(a);
    expect(skills.length).toBe(1);
    expect(skills[0].group).toBe('not_recommended_yet');
    expect(skills[0].virtual).toBe(true);
    fs.rmSync(fix.cwd, { recursive: true, force: true });
  });

  it('skill candidate is generated when 3+ similar sessions and a clear scope dominate', () => {
    const fix = buildFixture({
      tools: [
        { name: 'Read', target: 'src/routes/a.js' },
        { name: 'Read', target: 'src/routes/b.js' },
        { name: 'Read', target: 'src/routes/c.js' },
        { name: 'Edit', target: 'src/routes/c.js' },
        { name: 'Bash', target: 'npm test' },
      ],
    });
    const a = analyzeSession({ ...fix, projectFiles: fix.projectFiles, similarSessionCount: 3 });
    const skills = generateSkillCandidates(a);
    expect(skills.length).toBe(1);
    expect(skills[0].kind).toBe('skill-candidate');
    expect(skills[0].path).toMatch(/^\.claude\/skills\/.+\/SKILL\.md$/);
    expect(skills[0].content).toMatch(/^---\nname: /);
    fs.rmSync(fix.cwd, { recursive: true, force: true });
  });

  it('buildOptimalFilesBundle returns groups and confidence labels', () => {
    const fix = buildFixture({
      tools: [
        { name: 'Read', target: 'src/db.js' },
        { name: 'Read', target: 'src/db.js' },
        { name: 'Read', target: 'src/db.js' },
        { name: 'Edit', target: 'src/db.js' },
        { name: 'Bash', target: 'npm test' },
      ],
      packageJson: { name: 'demo', scripts: { test: 'node --test' } },
    });
    const result = buildOptimalFilesBundle({
      session: fix.session, project: fix.project, toolEvents: fix.toolEvents,
      projectCwd: fix.cwd, projectFiles: fix.projectFiles,
      existingPaths: existingPathsIn(fix.cwd),
    });
    expect(result.bundle.length).toBeGreaterThanOrEqual(3);
    expect(result.groups.recommended_now.length).toBeGreaterThanOrEqual(1);
    for (const f of result.bundle) {
      expect(f.path).toBeTruthy();
      expect(f.kind).toBeTruthy();
      expect(typeof f.content).toBe('string');
      expect(f.reason).toBeTruthy();
      expect(['high', 'medium', 'low']).toContain(f.confidence);
      expect(['commit', 'gitignore', 'review']).toContain(f.commitRecommendation);
      expect(f.secretScan).toBeTruthy();
      expect(typeof f.secretScan.redactions).toBe('number');
      expect(['new', 'conflict', 'unsafe', 'n/a', 'unknown']).toContain(f.overwriteRisk);
    }
    fs.rmSync(fix.cwd, { recursive: true, force: true });
  });

  it('planBundleSelections refuses to overwrite existing files by default', () => {
    const fix = buildFixture({
      tools: [{ name: 'Read', target: 'src/a.js' }, { name: 'Read', target: 'src/a.js' }],
      files: { 'CLAUDE.md': '# pre-existing\n' },
    });
    const built = buildOptimalFilesBundle({
      session: fix.session, project: fix.project, toolEvents: fix.toolEvents,
      projectCwd: fix.cwd, projectFiles: fix.projectFiles,
      existingPaths: existingPathsIn(fix.cwd),
    });
    const plan = planBundleSelections({
      bundle: built.bundle,
      projectCwd: fix.cwd,
      selections: [{ path: 'CLAUDE.md', overwrite: false }],
      existingPaths: existingPathsIn(fix.cwd),
    });
    expect(plan.results[0].status).toBe('conflict');
    expect(fs.readFileSync(path.join(fix.cwd, 'CLAUDE.md'), 'utf8')).toBe('# pre-existing\n');
    fs.rmSync(fix.cwd, { recursive: true, force: true });
  });

  it('apply with overwrite:true rewrites the existing file', () => {
    const fix = buildFixture({
      tools: [{ name: 'Read', target: 'src/a.js' }, { name: 'Read', target: 'src/a.js' }],
      files: { 'CLAUDE.md': '# pre-existing\n' },
    });
    const built = buildOptimalFilesBundle({
      session: fix.session, project: fix.project, toolEvents: fix.toolEvents,
      projectCwd: fix.cwd, projectFiles: fix.projectFiles,
      existingPaths: existingPathsIn(fix.cwd),
    });
    const plan = planBundleSelections({
      bundle: built.bundle,
      projectCwd: fix.cwd,
      selections: [{ path: 'CLAUDE.md', overwrite: true }],
      existingPaths: existingPathsIn(fix.cwd),
    });
    expect(plan.results[0].status).toBe('overwrite_planned');
    const apply = applyBundlePlan({ plan: plan.results, projectCwd: fix.cwd });
    expect(apply.results[0].status).toBe('overwritten');
    expect(fs.readFileSync(path.join(fix.cwd, 'CLAUDE.md'), 'utf8')).not.toBe('# pre-existing\n');
    fs.rmSync(fix.cwd, { recursive: true, force: true });
  });

  it('planBundleSelections refuses unsafe paths and never escapes project cwd', () => {
    const fix = buildFixture({ tools: [{ name: 'Read', target: 'src/a.js' }] });
    const fakeBundle = [{
      path: '../../../etc/passwd-stealer',
      content: 'x',
      kind: 'fake', group: 'optional', confidence: 'low',
    }];
    const plan = planBundleSelections({
      bundle: fakeBundle,
      projectCwd: fix.cwd,
      selections: [{ path: '../../../etc/passwd-stealer' }],
    });
    expect(plan.results[0].status).toBe('unsafe_path');
    fs.rmSync(fix.cwd, { recursive: true, force: true });
  });

  it('absolutize refuses absolute bundle paths and traversal', () => {
    const cwd = tmpDir('abs');
    try {
      expect(absolutize(cwd, '/etc/passwd')).toBe(null);
      expect(absolutize(cwd, 'C:\\Windows\\System32')).toBe(null);
      expect(absolutize(cwd, '../../somewhere')).toBe(null);
      expect(absolutize(cwd, 'CLAUDE.md')).toBeTruthy();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('listGeneratedFiles returns only known generated paths', () => {
    const cwd = tmpDir('list');
    try {
      fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'x');
      fs.writeFileSync(path.join(cwd, 'unrelated.txt'), 'y');
      fs.mkdirSync(path.join(cwd, '.claude', 'rules'), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.claude', 'rules', 'api.md'), 'z');
      const files = listGeneratedFiles(cwd);
      const paths = files.map(f => f.path);
      expect(paths).toContain('CLAUDE.md');
      expect(paths.some(p => p.endsWith('api.md'))).toBe(true);
      expect(paths.includes('unrelated.txt')).toBe(false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('bundle secret-scan replaces leaked content with redacted version', () => {
    const fix = buildFixture({
      tools: [{ name: 'Read', target: 'src/cfg.js' }, { name: 'Read', target: 'src/cfg.js' }],
      files: {
        'src/cfg.js': "const STRIPE_SECRET_KEY = 'sk_test_AbCdEfGhIjKlMnOpQrSt12345';\nmodule.exports = { STRIPE_SECRET_KEY };\n",
      },
    });
    const result = buildOptimalFilesBundle({
      session: fix.session, project: fix.project, toolEvents: fix.toolEvents,
      projectCwd: fix.cwd, projectFiles: fix.projectFiles,
      existingPaths: existingPathsIn(fix.cwd),
    });
    for (const f of result.bundle) {
      expect(f.content || '').not.toMatch(/sk_test_AbCdEfGhIjKlMnOpQrSt12345/);
    }
    fs.rmSync(fix.cwd, { recursive: true, force: true });
  });
});
