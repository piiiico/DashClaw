/**
 * Deterministic task classifier. DashClaw has no task taxonomy of its own
 * (action_type is a free string), so the Behavior Learning analyzer needs a
 * stable, dependency-free way to label a unit of work for the
 * model/task-mismatch rule. Same input always yields the same label + score.
 *
 * Operates on either a single sample's signals or an aggregated "work unit"
 * (joined declared goals/commands + the union of touched paths + a file count),
 * which is how the analyzer detects session-scale heavy work that a single
 * tool call can't reveal.
 *
 * Classes: migration, security_review, refactor, debugging, architecture,
 * testing, deployment, research, maintenance, other. The first five are the
 * "heavy" classes the spec names as wrong fits for a cheap model.
 */

export const TASK_CLASSES = [
  'migration', 'security_review', 'refactor', 'debugging', 'architecture',
  'testing', 'deployment', 'research', 'maintenance', 'other',
];

export const HEAVY_TASK_CLASSES = Object.freeze([
  'migration', 'security_review', 'refactor', 'debugging', 'architecture',
]);

// Ordered so that more specific / higher-stakes classes win ties. Each rule
// contributes its weight when its pattern hits the joined text; path/structural
// signals add extra weight on top.
const RULES = [
  { class: 'migration', weight: 3, re: /\bmigrat|schema change|drizzle|db:generate|db:migrate|alter table|create table|\bddl\b|\.sql\b/i },
  { class: 'security_review', weight: 3, re: /security review|threat model|vulnerab|owasp|\bcsrf\b|\bxss\b|\bssrf\b|injection|pen.?test|audit.*secur|secur.*audit|harden/i },
  { class: 'refactor', weight: 2, re: /\brefactor|restructur|reorganiz|extract (?:a )?(?:function|module|component)|de-?duplicat|rename across|repo-?wide/i },
  { class: 'debugging', weight: 2, re: /\bdebug|reproduc|stack ?trace|traceback|root cause|failing test|investigat.*(?:bug|failure|error)/i },
  { class: 'architecture', weight: 2, re: /architect|system design|module boundar|data ?flow|\brfc\b|\badr\b|design (?:the|a) (?:system|api)|scaffold/i },
  { class: 'testing', weight: 2, re: /\bvitest|pytest|\bjest\b|unit test|integration test|\bcoverage\b|test suite|\bspec\b/i },
  { class: 'deployment', weight: 2, re: /\bdeploy|\brelease\b|\bship\b|\bpublish\b|vercel|production build|\brollback\b/i },
  { class: 'research', weight: 1, re: /\bresearch|investigat|\bexplore|understand the|look ?up|read through|survey the/i },
  { class: 'maintenance', weight: 1, re: /update (?:the )?depend|bump|\blint\b|\bformat\b|\bchore\b|cleanup|config(?:ure|uration)?/i },
];

// Path-based reinforcement: touching these trees strongly implies a class.
const PATH_RULES = [
  { class: 'migration', weight: 3, re: /(^|\/)(drizzle|migrations|schema)(\/|$)|\.sql$/i },
  { class: 'security_review', weight: 2, re: /(^|\/)(auth|secrets|middleware)(\/|$)|middleware\.(?:js|ts)$/i },
  { class: 'testing', weight: 2, re: /(\.test\.|\.spec\.|(^|\/)(tests?|__tests__)\/)/i },
];

/**
 * Classify a work unit.
 * @param {object} ctx
 * @param {string} [ctx.text]       joined declared goals / command shapes
 * @param {string} [ctx.action_type]
 * @param {string[]} [ctx.writePaths]
 * @param {string[]} [ctx.readPaths]
 * @param {string} [ctx.tool]
 * @param {number} [ctx.fileCount]  distinct files touched in the unit
 * @returns {{task_class:string, confidence:number, heavy:boolean, scores:object}}
 */
export function classifyTask(ctx = {}) {
  const text = String(ctx.text || '');
  const actionType = String(ctx.action_type || '').toLowerCase();
  const paths = [...(ctx.writePaths || []), ...(ctx.readPaths || [])];
  const fileCount = Number(ctx.fileCount) || (ctx.writePaths ? ctx.writePaths.length : 0);

  const scores = Object.create(null);
  const add = (cls, w) => { scores[cls] = (scores[cls] || 0) + w; };

  for (const rule of RULES) {
    if (rule.re.test(text)) add(rule.class, rule.weight);
  }
  for (const rule of PATH_RULES) {
    if (paths.some((p) => rule.re.test(String(p)))) add(rule.class, rule.weight);
  }

  // action_type direct hints.
  const ACTION_HINTS = {
    migrate: 'migration', security: 'security_review', refactor: 'refactor',
    fix: 'debugging', test: 'testing', deploy: 'deployment', research: 'research',
    review: 'research', config: 'maintenance', cleanup: 'maintenance',
  };
  if (ACTION_HINTS[actionType]) add(ACTION_HINTS[actionType], 2);

  // Multi-file work amplifies refactor/debugging (the "repo-wide" / "multi-file"
  // signals the spec calls out) — but only when there's already a base signal.
  if (fileCount >= 4) {
    if (scores.refactor) add('refactor', 2);
    if (scores.debugging) add('debugging', 2);
  }

  let best = 'other';
  let bestScore = 0;
  // Deterministic: iterate TASK_CLASSES in fixed order so equal scores resolve
  // to the higher-priority (earlier) class.
  for (const cls of TASK_CLASSES) {
    const s = scores[cls] || 0;
    if (s > bestScore) { best = cls; bestScore = s; }
  }

  // Confidence: 0 signals → 0; scales with accumulated weight, capped.
  const confidence = bestScore === 0 ? 0 : Math.min(95, 35 + bestScore * 12);

  return {
    task_class: best,
    confidence,
    heavy: HEAVY_TASK_CLASSES.includes(best),
    scores,
  };
}
