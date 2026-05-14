/**
 * Billing & Cost Calculation Library
 */

/**
 * Default model pricing (USD per million tokens).
 *
 * Entries optionally carry `cache_write` and `cache_read` rates for models
 * that support prompt caching. When an entry omits these, callers that
 * supply `extras` to `estimateCost` see a 0 contribution for the cache
 * components — preserving the legacy 4-arg behaviour bit-for-bit.
 *
 * The cache rates added here are sourced from `app/lib/claude-code/pricing.js`
 * (the AgentLens-derived 4-column table). They populate only the three
 * models that have published cache-pricing for Code Sessions analytics:
 * opus-4-7, sonnet-4-6, haiku-4-5. Other entries are left to default to 0.
 */
export const DEFAULT_PRICING = [
  // Anthropic Claude 4.5/4.6/4.7 family.
  //
  // Pricing source: platform.claude.com/docs/en/about-claude/pricing.
  // Opus 4.5/4.6/4.7 all share new lower rates ($5/$25). Opus 4.1 kept the
  // legacy $15/$75 rates — preserved as the unversioned 'opus' default so
  // legacy ingests that report only "opus" don't get silently re-priced.
  // Cache rates follow the family rule: cache_write = 1.25x input, cache_read
  // = 0.10x input.
  { pattern: 'opus-4-7', label: 'Claude Opus 4.7', input: 5, output: 25, cache_write: 6.25, cache_read: 0.50 },
  { pattern: 'opus-4-6', label: 'Claude Opus 4.6', input: 5, output: 25, cache_write: 6.25, cache_read: 0.50 },
  { pattern: 'opus-4-5', label: 'Claude Opus 4.5', input: 5, output: 25, cache_write: 6.25, cache_read: 0.50 },
  { pattern: 'opus-4-1', label: 'Claude Opus 4.1 (legacy)', input: 15, output: 75, cache_write: 18.75, cache_read: 1.50 },
  { pattern: 'opus', label: 'Claude Opus (legacy default)', input: 15, output: 75, cache_write: 18.75, cache_read: 1.50 },
  { pattern: 'sonnet-4-6', label: 'Claude Sonnet 4.6', input: 3, output: 15, cache_write: 3.75, cache_read: 0.30 },
  { pattern: 'sonnet-4-5', label: 'Claude Sonnet 4.5', input: 3, output: 15, cache_write: 3.75, cache_read: 0.30 },
  { pattern: 'sonnet', label: 'Claude Sonnet (default)', input: 3, output: 15, cache_write: 3.75, cache_read: 0.30 },
  { pattern: 'haiku-4-5', label: 'Claude Haiku 4.5', input: 1, output: 5, cache_write: 1.25, cache_read: 0.10 },
  { pattern: 'haiku', label: 'Claude Haiku (default)', input: 1, output: 5, cache_write: 1.25, cache_read: 0.10 },
  // OpenAI
  { pattern: 'codex-5.4', label: 'Codex 5.4', input: 3, output: 15 },
  { pattern: 'codex', label: 'Codex (default)', input: 3, output: 15 },
  { pattern: 'o3-pro', label: 'o3-pro', input: 150, output: 600 },
  { pattern: 'o3-mini', label: 'o3-mini', input: 1.10, output: 4.40 },
  { pattern: 'o3', label: 'o3', input: 10, output: 40 },
  { pattern: 'o4-mini', label: 'o4-mini', input: 1.10, output: 4.40 },
  { pattern: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', input: 0.40, output: 1.60 },
  { pattern: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', input: 0.10, output: 0.40 },
  { pattern: 'gpt-4.1', label: 'GPT-4.1', input: 2, output: 8 },
  { pattern: 'gpt-4o-mini', label: 'GPT-4o Mini', input: 0.15, output: 0.60 },
  { pattern: 'gpt-4o', label: 'GPT-4o', input: 2.50, output: 10 },
  // Google Gemini
  { pattern: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', input: 1.25, output: 10 },
  { pattern: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', input: 0.15, output: 0.60 },
  // Meta Llama (hosted pricing varies by provider — these are typical)
  { pattern: 'llama-4-maverick', label: 'Llama 4 Maverick', input: 0.50, output: 0.77 },
  { pattern: 'llama-4-scout', label: 'Llama 4 Scout', input: 0.17, output: 0.35 },
];

const _warnedUnknownModels = new Set();

/**
 * Estimate cost based on token usage and model.
 *
 * Backwards-compatible 4-arg form is preserved bit-for-bit. The optional
 * 5th `extras` argument adds cache-aware components without changing the
 * unknown-model contract (still $0 + one-time warn).
 *
 * @param {number} tokensIn - Input tokens.
 * @param {number} tokensOut - Output tokens.
 * @param {string|null|undefined} model - Model identifier. Falsy/unknown
 *        returns 0 — we refuse to guess because a wrong guess pollutes
 *        cost dashboards. Historically this fell back to the first
 *        (Opus-tier) pricing row, which priced cheap open-source models
 *        (Llama, Groq, Sonar, DeepSeek) at ~1000x their real cost.
 * @param {Array<{pattern: string, input: number, output: number, cache_write?: number, cache_read?: number}>|null} customPricing
 *        Optional custom pricing table from org settings.
 * @param {{ cache_creation_tokens?: number, cache_read_tokens?: number }|null} extras
 *        Optional cache-token components. When non-null and the model has
 *        cache pricing, adds `(cw * cache_write + cr * cache_read) / 1e6`.
 *        Entries without cache columns contribute 0 — so 4-arg callers and
 *        unknown models behave exactly as before.
 * @returns {number} Estimated cost in USD.
 */
export function estimateCost(tokensIn, tokensOut, model, customPricing = null, extras = null) {
  if (!model) return 0;
  const m = String(model).toLowerCase();
  const pricing = customPricing || DEFAULT_PRICING;

  for (const entry of pricing) {
    if (m.includes(entry.pattern)) {
      const base = (tokensIn * entry.input / 1_000_000) + (tokensOut * entry.output / 1_000_000);
      if (!extras) return base;
      const cw = Number(extras.cache_creation_tokens) || 0;
      const cr = Number(extras.cache_read_tokens) || 0;
      const cwRate = Number(entry.cache_write) || 0;
      const crRate = Number(entry.cache_read) || 0;
      return base + (cw * cwRate + cr * crRate) / 1_000_000;
    }
  }

  if (!_warnedUnknownModels.has(m)) {
    _warnedUnknownModels.add(m);
    console.warn('[billing] Unknown model, pricing as $0 (extend DEFAULT_PRICING or set org custom pricing):', model);
  }
  return 0;
}
