/**
 * Shared definitions for the "MoltFire + Claude Code Branch Finish" operating loop.
 *
 * Imported by:
 *   - scripts/seed-branch-finish-loop.mjs  (creates the templates/knowledge/workflow)
 *   - scripts/branch-finish.mjs            (runs the loop; looks resources up by these identifiers)
 *
 * Keeping the identifiers (category, collection name, scorer config) in one place
 * means the seeder and the runner can never drift apart.
 */

// Prompt Library — every branch-finish template lives under this category so the
// runner and the operator UI can list them with a single filtered query.
export const PROMPT_CATEGORY = 'branch-finish';

// The prompt the runner renders for a Claude Code branch finish.
export const BRANCH_FINISH_TEMPLATE = 'Branch Finish Review';

// Reusable templates seeded into the Prompt Library. Bodies use {{mustache}}
// variables (the same {{var}} syntax app/lib/prompt.js renders).
export const PROMPT_TEMPLATES = [
  {
    name: 'Build Brief',
    description: 'Frame a new build before writing code: goal, constraints, success criteria.',
    content: `You are starting a build. Before writing any code, restate the work as a verifiable goal.

Goal: {{goal}}
Constraints: {{constraints}}
Definition of done: {{success_criteria}}

Respond with:
1. The smallest plan that satisfies the goal (no speculative scope).
2. The first verification step (a failing test or a concrete check) per item.
3. Any assumption you are making, stated explicitly.`,
  },
  {
    name: BRANCH_FINISH_TEMPLATE,
    description: 'Finish and review a Claude Code branch before merge/push: tests, scope, risks.',
    content: `You are finishing the branch "{{branch}}".

Summary of changes:
{{summary}}

Test status: {{tests_status}}
Changed files:
{{changed_files}}
Known risks: {{risks}}

Do a rigorous branch-finish pass and respond with:
1. Whether the work is mergeable, with evidence (tests run + output, not assertions).
2. Every changed line that does NOT trace to the stated goal (scope creep to remove).
3. Silent failures, swallowed errors, or unverified claims.
4. The exact commands to verify locally (lint, full test suite, build).
5. A one-line, paste-safe commit subject + body.`,
  },
  {
    name: 'Code Review',
    description: 'Review a diff for correctness, security, and convention adherence.',
    content: `Review the following change for correctness bugs, security issues, and convention drift.

Focus: {{focus}}
Diff:
{{diff}}

Report only high-confidence findings. For each: file:line, why it is wrong, and the minimal fix. Call out anything that looks like a fake card, placeholder, mock-echo test, or TODO standing in for real behavior.`,
  },
  {
    name: 'Bugfix Pass',
    description: 'Reproduce-first bugfix: failing test, root cause, minimal fix.',
    content: `Fix this bug the disciplined way.

Symptom: {{symptom}}
Reproduction: {{repro}}

Respond with:
1. A failing test that reproduces the bug (write it first).
2. The verified root cause (read the relevant code at the exact line — do not theorize).
3. The minimal fix that makes the test pass without expanding scope.
4. Confirmation the full test suite still passes.`,
  },
  {
    name: 'Prompt Capture',
    description: 'Capture a prompt that worked well so it becomes a reusable template.',
    content: `Capture this prompt as a reusable template.

Prompt that worked: {{prompt}}
Why it worked: {{why}}

Respond with:
1. A generalized version with {{variables}} extracted for the parts that change.
2. A one-line description and a category.
3. The variable list and an example invocation.`,
  },
  {
    name: 'Teaching Mastery',
    description: 'Teach a concept to durable mastery, not just recall.',
    content: `Teach "{{topic}}" to mastery for a learner at the {{level}} level.

Respond with:
1. The single most load-bearing idea, stated plainly.
2. A worked example, then a near-miss that breaks if the idea is misunderstood.
3. Two checks-for-understanding the learner must pass before moving on.`,
  },
];

// Knowledge — the standards/preferences the branch-finish loop searches. We store
// the canonical text in item metadata.body so the runner can do a local
// substring search when no embedding key is configured (vector search needs one).
export const KNOWLEDGE_COLLECTION = {
  name: 'Branch Finish — Wes Coding Standards',
  description: 'Standards, policies, and preferences the MoltFire + Claude Code branch-finish loop searches.',
  source_type: 'notes',
  tags: ['standards', 'branch-finish', 'moltfire'],
};

export const KNOWLEDGE_ITEMS = [
  {
    source_uri: 'note://zero-slop',
    title: 'ZERO SLOP',
    body: 'No fake cards, no placeholder UI, no fake buttons, no hallucinated APIs, no mock-echo tests, no TODO standing in for core behavior. Tests must assert real outputs, status changes, validation failures, and error paths. If schema changes, update schema + migration + docs in the same change.',
  },
  {
    source_uri: 'note://one-command-launcher',
    title: 'One-command launcher policy',
    body: 'Every project ships a one-command launcher. Deploy must be zero-friction: no manual db:push, no cloning the repo, the deploy button must produce a working instance. Free-tier only ($0 to deploy); no cron jobs or paid-tier features.',
  },
  {
    source_uri: 'note://wes-coding-standards',
    title: 'Wes coding standards',
    body: 'Simplicity first: the minimum code that solves the problem, nothing speculative. Surgical changes: every changed line traces to the request; do not refactor what is not broken; match the repo style. Verify before claiming done: run lint + the FULL test suite + build and READ the output. A push is its own step. Fail loudly — never swallow errors.',
  },
  {
    source_uri: 'note://dashclaw-facts',
    title: 'DashClaw facts',
    body: 'DashClaw is a minimal governance runtime, not an agent platform — it governs goals, it does not give agents tools to achieve them. Core runtime is app/api/. No direct SQL in route files — use repositories (app/lib/repositories/*.repository.js). Neon HTTP driver: no sql.begin transactions; idempotency comes from ON CONFLICT + sequential statements. Numeric columns return as strings — coerce with Number().',
  },
  {
    source_uri: 'note://moltfire-preferences',
    title: 'MoltFire collaboration preferences',
    body: 'State assumptions explicitly and ask when uncertain; present multiple interpretations rather than silently picking one. Push back when a simpler approach exists. Default to autonomous execution for well-scoped work. Evidence over decoration. Calm, terse status. Approval-gate anything touching auth, billing, production, or migrations.',
  },
];

// Evaluations — the branch-finish quality gate, expressed as a dry-run scorer
// config (POST /api/evaluations/scorers/preview). No DB row is written; the
// runner and the operator UI both score against this same config.
export const QUALITY_SCORER = {
  scorer_type: 'contains',
  // A finished branch outcome should evidence the load-bearing signals.
  config: {
    keywords: ['tests pass', 'lint', 'build', 'no scope creep'],
    mode: 'any',
    match_score: 1.0,
    no_match_score: 0.0,
  },
};

// Workflows — a saved (draft) template that links the loop's resources together
// so it is visible and traceable on /workflows. The live loop is run by
// scripts/branch-finish.mjs (the native executor needs a model strategy to run
// prompt steps, which this declarative template intentionally does not bind).
export const WORKFLOW_TEMPLATE = {
  name: 'MoltFire + Claude Code Branch Finish',
  slug: 'moltfire-claude-code-branch-finish',
  description: 'Render the branch-finish review prompt, search the standards knowledge, govern the risky push, and score the outcome.',
  objective: 'Finish a Claude Code branch with governance: standards-aware review + approval-gated push + recorded outcome.',
  status: 'draft',
};
