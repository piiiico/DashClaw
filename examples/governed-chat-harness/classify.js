/**
 * Tool classification for the governed chat harness.
 *
 * Mirrors the intent to action_type mapping used by the Claude Code hooks
 * (hooks/dashclaw_pretool.py) so the ledger rows produced here line up with
 * the vocabulary already in your DashClaw instance.
 *
 * Every tool the model calls passes through here to get an action_type, a
 * risk_score (0..100), a reversible flag, and a one line declared_goal before
 * it reaches the guard. A tool can override any of this by exporting a
 * `governance` object in the registry (see tools.js).
 *
 * The risk_score matters more than the label for the chat harness: your global
 * risk_threshold policies (warn 50, require_approval 60, block 90) fire for any
 * agent, so a send or a charge that scores 70+ lands in your approval queue even
 * when its action_type is not one your string matched policies name explicitly.
 */

// Intent to action_type. Communication and financial are split out so they
// carry approval worthy risk instead of collapsing into a generic bucket.
const INTENT_TO_ACTION = {
  readonly: 'review',
  write: 'apply',
  destructive: 'security',
  network: 'api',
  communication: 'message',
  financial: 'security',
  deploy: 'deploy',
  process_management: 'security',
  package_management: 'build',
  system_admin: 'deploy',
  unknown: 'other',
};

const INTENT_RISK = {
  readonly: 15,
  write: 35,
  destructive: 85,
  network: 30,
  communication: 70,
  financial: 85,
  deploy: 80,
  process_management: 70,
  package_management: 45,
  system_admin: 80,
  unknown: 20,
};

const IRREVERSIBLE = new Set(['destructive', 'deploy', 'system_admin', 'communication', 'financial']);

// Verb patterns, checked against a normalized name so word boundaries actually
// fire. Order matters: destructive and financial outrank gentler matches.
const DESTRUCTIVE = /\b(delete|destroy|drop|remove|truncate|wipe|purge|erase|rm)\b/;
const FINANCIAL = /\b(charge|pay|payment|refund|transfer|invoice|withdraw|deposit|wire|payout)\b/;
const COMMUNICATION = /\b(send|email|message|notify|reply|dm|tweet|broadcast|publish|post)\b/;
const DEPLOY = /\b(deploy|release|rollout|provision|ship)\b/;
const WRITE = /\b(write|create|update|edit|patch|insert|save|upload|put|set|append)\b/;
const NETWORK = /\b(fetch|http|request|browse|download|call|api)\b/;
const READONLY = /\b(read|list|view|show|inspect|describe|status|check|lookup|get|find|query|search)\b/;

/**
 * Normalize a tool name into a space separated, lowercase token string so the
 * verb patterns above match. Handles mcp__server__method names (the method is
 * what carries intent) and camelCase, snake_case, and kebab-case.
 */
function normalizeName(name) {
  let s = String(name || '');
  if (s.startsWith('mcp__')) {
    const parts = s.split('__');
    s = parts.length >= 3 ? parts.slice(2).join('_') : parts.slice(1).join('_');
  }
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2'); // camelCase -> spaced
  s = s.replace(/[_\-./]+/g, ' ');              // separators -> spaces
  return ' ' + s.toLowerCase().trim() + ' ';    // pad edges so \b is clean
}

function inferIntent(name) {
  const n = normalizeName(name);
  if (DESTRUCTIVE.test(n)) return 'destructive';
  if (FINANCIAL.test(n)) return 'financial';
  if (COMMUNICATION.test(n)) return 'communication';
  if (DEPLOY.test(n)) return 'system_admin';
  if (WRITE.test(n)) return 'write';
  if (NETWORK.test(n)) return 'network';
  if (READONLY.test(n)) return 'readonly';
  return 'unknown';
}

function clamp(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Classify one tool call.
 * @param {string} name   Tool name (e.g. 'web_fetch', 'mcp__gmail__send').
 * @param {object} input  The arguments the model passed.
 * @param {object} [hint] Optional governance override from the registry.
 * @returns {{action_type:string, risk_score:number, reversible:boolean, declared_goal:string, systems_touched:string[], category:string}}
 */
export function classifyTool(name, input = {}, hint = {}) {
  const isMcp = String(name || '').startsWith('mcp__');
  const category = hint.category || (isMcp ? 'mcp' : 'function');

  // Start from the inferred intent, then let the hint win where present.
  const intent = hint.intent || inferIntent(name);
  const action_type = hint.action_type || INTENT_TO_ACTION[intent] || 'other';

  let risk_score = hint.risk_score != null ? hint.risk_score : (INTENT_RISK[intent] ?? 20);

  // MCP calls reach an external system, so never treat them as trivially safe.
  if (isMcp && hint.risk_score == null) risk_score = Math.max(risk_score, 40);

  const reversible = hint.reversible != null ? hint.reversible : !IRREVERSIBLE.has(intent);

  const preview = JSON.stringify(input ?? {}).slice(0, 120);
  const declared_goal = hint.declared_goal || `${name}: ${preview}`;
  const systems_touched = hint.systems_touched || [category];

  return { action_type, risk_score: clamp(risk_score), reversible, declared_goal, systems_touched, category };
}
