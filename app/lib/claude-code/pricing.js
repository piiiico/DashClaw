/**
 * Claude Code session pricing — 4-column per-model rates (input, output,
 * cache_write, cache_read) in USD per 1M tokens.
 *
 * Distinct from `app/lib/billing.js` which prices `action_records` rows with a
 * 2-column table and folds cache_read into tokens_in at 0.1×. This module
 * preserves the raw cache token signal so the Code Sessions surface can show
 * cache-aware totals and the `BAD_CACHE_HIT` rule has real input.
 *
 * Ported from AgentLens (`src/pricing.js`) — CommonJS → ESM. No DB. No HTTP.
 * No fs.
 */

export const PRICES_PER_MTOK = Object.freeze({
  'claude-opus-4-7':            { input: 15.00, output: 75.00, cache_write: 18.75, cache_read: 1.50 },
  'claude-opus-4-7[1m]':        { input: 15.00, output: 75.00, cache_write: 18.75, cache_read: 1.50 },
  'claude-opus-4-6':            { input: 15.00, output: 75.00, cache_write: 18.75, cache_read: 1.50 },
  'claude-sonnet-4-6':          { input:  3.00, output: 15.00, cache_write:  3.75, cache_read: 0.30 },
  'claude-sonnet-4-5':          { input:  3.00, output: 15.00, cache_write:  3.75, cache_read: 0.30 },
  'claude-haiku-4-5':           { input:  1.00, output:  5.00, cache_write:  1.25, cache_read: 0.10 },
  'claude-haiku-4-5-20251001':  { input:  1.00, output:  5.00, cache_write:  1.25, cache_read: 0.10 },
});

export const FALLBACK = { input: 3.00, output: 15.00, cache_write: 3.75, cache_read: 0.30 };

export function priceFor(model) {
  if (!model) return FALLBACK;
  if (PRICES_PER_MTOK[model]) return PRICES_PER_MTOK[model];
  const stripped = String(model).replace(/\[[^\]]*\]$/, '');
  return PRICES_PER_MTOK[stripped] || FALLBACK;
}

export function costForUsage(model, usage) {
  const p = priceFor(model);
  const i = Number(usage?.input_tokens) || 0;
  const o = Number(usage?.output_tokens) || 0;
  const cw = Number(usage?.cache_creation_input_tokens) || 0;
  const cr = Number(usage?.cache_read_input_tokens) || 0;
  return (
    (i * p.input + o * p.output + cw * p.cache_write + cr * p.cache_read) / 1_000_000
  );
}

export function cacheSavingsForUsage(model, usage) {
  const p = priceFor(model);
  const cr = Number(usage?.cache_read_input_tokens) || 0;
  return (cr * (p.input - p.cache_read)) / 1_000_000;
}

export function cacheHitRate(totals) {
  const i = totals.input_tokens || 0;
  const cw = totals.cache_creation_tokens || 0;
  const cr = totals.cache_read_tokens || 0;
  const denom = i + cw + cr;
  if (!denom) return 0;
  return cr / denom;
}

export function formatUSD(n) {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}
