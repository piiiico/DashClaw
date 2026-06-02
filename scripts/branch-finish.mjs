#!/usr/bin/env node

/**
 * MoltFire + Claude Code — Branch Finish loop.
 *
 * One governed pass to finish a Claude Code branch. It does NOT touch git or any
 * external system itself — it renders the review prompt and governs the work so
 * Wes/MoltFire (or Claude Code) can finish the branch with evidence:
 *
 *   1. Render the branch-finish review prompt (Prompt Library)
 *   2. Search the coding-standards knowledge (Knowledge; local fallback if no embeddings)
 *   3. Guard-gate the risky push to main (Guard/Policies — approval gating)
 *   4. Simulate a proposed risk policy over recent history (Policies — side-effect-free)
 *   5. Check capability health (Capabilities)
 *   6. Score the branch-finish quality (Evaluations — dry-run scorer, no writes)
 *   7. Read prior learning recommendations (Learning)
 *   8. Record the outcome (Learning — write; skipped with --dry-run)
 *   9. Read the inbox and mark it read (Messages — write; skipped with --dry-run)
 *
 * --dry-run performs NO writes (no learning record, no mark-read) and never
 * touches anything external. Run `node scripts/seed-branch-finish-loop.mjs` once
 * first to create the templates + knowledge it reads.
 *
 * Usage:
 *   node scripts/branch-finish.mjs --dry-run
 *   node scripts/branch-finish.mjs --branch my-feature --summary "..." --risks "..."
 *   DASHCLAW_URL=... DASHCLAW_API_KEY=oc_... node scripts/branch-finish.mjs
 */

import { execFileSync } from 'node:child_process';
import { DashClaw, GuardBlockedError } from '../sdk/dashclaw.js';
import {
  PROMPT_CATEGORY,
  BRANCH_FINISH_TEMPLATE,
  KNOWLEDGE_COLLECTION,
  QUALITY_SCORER,
} from './lib/branch-finish-defs.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : fallback;
}

const BASE_URL = process.env.DASHCLAW_URL || process.env.DASHCLAW_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.DASHCLAW_API_KEY || '';
const AGENT_ID = flag('--agent', process.env.DASHCLAW_AGENT_ID || 'claude-code');

if (!API_KEY) {
  console.error('DASHCLAW_API_KEY is required. Run via env vars or _run-with-env.');
  process.exit(1);
}

const claw = new DashClaw({ baseUrl: BASE_URL, apiKey: API_KEY, agentId: AGENT_ID });

// ---- git context (best-effort; flags win) ----------------------------------
function git(gitArgs, fallback = '') {
  try {
    // execFileSync (no shell) — git args are static literals, never interpolated.
    return execFileSync('git', gitArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}
const branch = flag('--branch', git(['rev-parse', '--abbrev-ref', 'HEAD'], 'HEAD'));
const changedFiles = flag('--files', git(['status', '--short'], '(clean working tree)')) || '(clean working tree)';
const summary = flag('--summary', git(['log', '-1', '--pretty=%s'], '(no commits)'));
const risks = flag('--risks', 'none stated');
const testsStatus = flag('--tests', 'not run');

// ---- output helpers --------------------------------------------------------
const steps = [];
function section(n, title) {
  console.log(`\n${'─'.repeat(64)}\n${n}. ${title}\n${'─'.repeat(64)}`);
}
function ok(label, detail) { steps.push({ label, status: 'ok' }); if (detail) console.log(detail); }
function warn(label, msg) { steps.push({ label, status: 'warn' }); console.log(`  ⚠ ${msg}`); }
function fail(label, msg) { steps.push({ label, status: 'fail' }); console.log(`  ✖ ${msg}`); }

async function run() {
  console.log(`Branch Finish — ${branch}${DRY_RUN ? '  [DRY RUN — no writes]' : ''}`);
  console.log(`Instance: ${BASE_URL}   Agent: ${AGENT_ID}`);

  // 1. Render the branch-finish review prompt -------------------------------
  section(1, 'Render branch-finish review prompt (Prompt Library)');
  try {
    const { templates = [] } = await claw.listPromptTemplates({ category: PROMPT_CATEGORY });
    const tmpl = templates.find((t) => t.name === BRANCH_FINISH_TEMPLATE);
    if (!tmpl) {
      warn('render', `No "${BRANCH_FINISH_TEMPLATE}" template. Run: node scripts/seed-branch-finish-loop.mjs`);
    } else {
      const rendered = await claw.renderPrompt({
        template_id: tmpl.id || tmpl.template_id,
        variables: { branch, summary, tests_status: testsStatus, changed_files: changedFiles, risks },
      });
      console.log(rendered.rendered);
      ok('render');
    }
  } catch (err) {
    fail('render', err.message);
  }

  // 2. Search the standards knowledge ---------------------------------------
  section(2, 'Search coding-standards knowledge (Knowledge)');
  try {
    const { collections = [] } = await claw.listKnowledgeCollections({ limit: 200 });
    const col = collections.find((c) => c.name === KNOWLEDGE_COLLECTION.name);
    if (!col) {
      warn('knowledge', `No "${KNOWLEDGE_COLLECTION.name}" collection. Run the seed script first.`);
    } else {
      const collectionId = col.collection_id || col.id;
      const query = 'branch finish standards: tests, scope, evidence, ZERO SLOP';
      try {
        const res = await claw.searchKnowledgeCollection(collectionId, query, { limit: 5 });
        const hits = res.results || [];
        if (hits.length === 0) throw Object.assign(new Error('no vector results'), { _fallback: true });
        hits.forEach((h) => console.log(`  • [${Number(h.score).toFixed(2)}] ${h.title || h.source_uri}: ${String(h.content).slice(0, 120)}`));
        ok('knowledge');
      } catch (searchErr) {
        // Vector search needs a BYOK embedding key. Degrade to a local
        // substring search over the item bodies stored in metadata.
        const needsKey = searchErr._fallback || /api key/i.test(searchErr.message) || searchErr.status === 400;
        const { items = [] } = await claw.listKnowledgeCollectionItems(collectionId);
        const terms = ['tests', 'scope', 'slop', 'verify', 'launcher'];
        const matched = items.filter((i) => {
          const body = `${i.title || ''} ${i.metadata?.body || ''}`.toLowerCase();
          return terms.some((t) => body.includes(t));
        });
        if (needsKey) console.log('  (semantic search unavailable — no embedding key; using local match over item bodies)');
        matched.slice(0, 5).forEach((i) => console.log(`  • ${i.title}: ${String(i.metadata?.body || '').slice(0, 120)}`));
        ok('knowledge');
      }
    }
  } catch (err) {
    fail('knowledge', err.message);
  }

  // 3. Guard-gate the risky push --------------------------------------------
  section(3, 'Guard-gate the push to main (Guard/Policies)');
  let pushDecision = 'unknown';
  try {
    const decision = await claw.guard({
      action_type: 'git_push',
      declared_goal: `Finish and push branch "${branch}" to main`,
      risk_score: 60,
      systems_touched: ['git', 'origin/main'],
      reversible: false,
    });
    pushDecision = decision.decision;
    console.log(`  decision: ${decision.decision}${decision.reason ? ` — ${decision.reason}` : ''}`);
    if (decision.decision === 'require_approval') {
      console.log('  → push requires human approval in Mission Control before proceeding.');
    }
    ok('guard');
  } catch (err) {
    if (err instanceof GuardBlockedError) {
      pushDecision = 'block';
      console.log(`  decision: block — ${err.decision?.reason || 'blocked by policy'}`);
      console.log('  → do NOT push; resolve the blocking policy first.');
      ok('guard');
    } else {
      fail('guard', err.message);
    }
  }

  // 4. Simulate a proposed risk policy --------------------------------------
  section(4, 'Simulate a risk-threshold policy over recent history (Policies — dry-run)');
  try {
    const sim = await claw.simulatePolicy({
      policy_type: 'risk_threshold',
      rules: { threshold: 70, action: 'require_approval' },
      days: 14,
    });
    const s = sim.summary || {};
    console.log(`  over ${sim.sample_size ?? 0} recent actions: ${s.require_approval || 0} would need approval, ${s.block || 0} blocked, ${s.warn || 0} warned`);
    ok('simulate');
  } catch (err) {
    fail('simulate', err.message);
  }

  // 5. Capability health -----------------------------------------------------
  section(5, 'Capability health (Capabilities)');
  try {
    const { capabilities = [] } = await claw.listCapabilityHealth({ limit: 25 });
    const unhealthy = capabilities.filter((c) => c.health_status && !['healthy', 'untested'].includes(c.health_status));
    console.log(`  ${capabilities.length} capabilities; ${unhealthy.length} need attention`);
    unhealthy.slice(0, 5).forEach((c) => console.log(`  • ${c.name || c.slug}: ${c.health_status}`));
    ok('capabilities');
  } catch (err) {
    fail('capabilities', err.message);
  }

  // 6. Score branch-finish quality (dry-run scorer) -------------------------
  section(6, 'Branch-finish quality score (Evaluations — dry-run, no writes)');
  try {
    const outcome = `Branch ${branch}: tests ${testsStatus}; changes — ${summary}; risks ${risks}`;
    const { result } = await claw.previewScorer({
      scorer_type: QUALITY_SCORER.scorer_type,
      config: QUALITY_SCORER.config,
      sample: { outcome, status: 'completed' },
    });
    console.log(`  score: ${result.score} (${result.label}) — ${result.reasoning}`);
    if (result.score != null && result.score < 1) {
      console.log('  → outcome is missing branch-finish evidence (tests/lint/build/no-scope-creep).');
    }
    ok('quality');
  } catch (err) {
    fail('quality', err.message);
  }

  // 7. Prior learning recommendations ---------------------------------------
  section(7, 'Prior learning recommendations (Learning)');
  try {
    const rec = await claw.getLearningRecommendations({ action_type: 'branch_finish', limit: 5 });
    const recs = rec.recommendations || [];
    if (recs.length === 0) {
      console.log('  (no recommendations yet — they accrue as outcomes are recorded)');
    } else {
      recs.forEach((r) => console.log(`  • [conf ${r.confidence}] ${(r.guidance || []).join('; ')}`));
    }
    ok('recommendations');
  } catch (err) {
    warn('recommendations', err.message);
  }

  // 8. Record the outcome (write) -------------------------------------------
  section(8, 'Record branch-finish outcome (Learning — write)');
  const outcomeLabel = pushDecision === 'block' ? 'blocked' : (testsStatus.includes('pass') ? 'success' : 'pending');
  const decisionText = `Branch finish: ${branch} (push ${pushDecision})`;
  if (DRY_RUN) {
    console.log(`  [dry-run] would record: "${decisionText}" → ${outcomeLabel}`);
    steps.push({ label: 'record', status: 'skip' });
  } else {
    try {
      const res = await claw.recordDecision({
        decision: decisionText,
        context: `branch=${branch}; tests=${testsStatus}; risks=${risks}`,
        reasoning: summary,
        outcome: outcomeLabel,
        confidence: 70,
      });
      ok('record', `  recorded decision ${res.decision?.id || ''}`.trimEnd());
    } catch (err) {
      fail('record', err.message);
    }
  }

  // 9. Inbox: read + mark read ----------------------------------------------
  section(9, 'Inbox (Messages)');
  try {
    const inbox = await claw.getInbox({ limit: 20 });
    const messages = inbox.messages || [];
    const unread = messages.filter((m) => !m.is_read);
    console.log(`  ${messages.length} messages, ${inbox.unread_count ?? unread.length} unread`);
    unread.slice(0, 5).forEach((m) => console.log(`  • ${m.subject || '(no subject)'} — from ${m.from_agent_id || '?'}`));
    if (DRY_RUN) {
      console.log(`  [dry-run] would mark ${unread.length} message(s) read`);
      steps.push({ label: 'inbox', status: 'skip' });
    } else if (unread.length > 0) {
      const res = await claw.markRead(unread.map((m) => m.id));
      ok('inbox', `  marked ${res.updated} read`);
    } else {
      ok('inbox');
    }
  } catch (err) {
    fail('inbox', err.message);
  }

  // ---- summary -------------------------------------------------------------
  section('✓', 'Summary');
  const counts = steps.reduce((acc, s) => ((acc[s.status] = (acc[s.status] || 0) + 1), acc), {});
  console.log(`  ${counts.ok || 0} ok · ${counts.warn || 0} warn · ${counts.skip || 0} skipped · ${counts.fail || 0} failed`);
  console.log(`  push verdict: ${pushDecision}`);
  if (DRY_RUN) console.log('\n  Dry run complete — no writes were made. Re-run without --dry-run to record + mark read.');
  process.exit(counts.fail ? 1 : 0);
}

run().catch((err) => {
  console.error(`branch-finish failed: ${err.message}`);
  process.exit(1);
});
