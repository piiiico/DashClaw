import crypto from 'node:crypto';

// There is NO shared slugify export in this repo. The house pattern is an inline
// per-repository copy (registered-agents / capabilities / workflow-templates
// repositories each define their own). Mirror it here.
function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 64) || 'provider';
}

function genId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
function parseJson(v) {
  if (v == null) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}

// --- Providers -------------------------------------------------------------
// CRUD here is create/list/get/update by design: providers are retired by setting
// status: 'disabled' via updateProvider (soft delete), never hard-deleted — no
// route exposes a destructive provider delete.

export async function createProvider(sql, orgId, data = {}) {
  const providerId = genId('prov');
  const slug = data.slug ? slugify(data.slug) : slugify(data.name || providerId);
  const rows = await sql`
    INSERT INTO x402_providers
      (provider_id, org_id, name, slug, description, category, base_url, status, default_currency, pricing_model, metadata)
    VALUES
      (${providerId}, ${orgId}, ${data.name || slug}, ${slug}, ${data.description || null}, ${data.category || 'research'},
       ${data.base_url || null}, ${data.status || 'active'}, ${data.default_currency || 'USDC'}, ${data.pricing_model || null},
       ${JSON.stringify(data.metadata || {})}::jsonb)
    RETURNING *`;
  return rows[0] || null;
}

export async function listProviders(sql, orgId, { status } = {}) {
  if (status) {
    return sql`SELECT * FROM x402_providers WHERE org_id = ${orgId} AND status = ${status} ORDER BY created_at DESC`;
  }
  return sql`SELECT * FROM x402_providers WHERE org_id = ${orgId} ORDER BY created_at DESC`;
}

export async function getProvider(sql, orgId, providerId) {
  const rows = await sql`SELECT * FROM x402_providers WHERE org_id = ${orgId} AND provider_id = ${providerId} LIMIT 1`;
  return rows[0] || null;
}

const PROVIDER_PATCHABLE = ['name', 'description', 'category', 'base_url', 'status', 'default_currency', 'pricing_model'];

export async function updateProvider(sql, orgId, providerId, patch = {}) {
  const existing = await getProvider(sql, orgId, providerId);
  if (!existing) return null;
  const next = { ...existing };
  for (const k of PROVIDER_PATCHABLE) if (patch[k] !== undefined) next[k] = patch[k];
  const metadata = patch.metadata !== undefined ? patch.metadata : parseJson(existing.metadata);
  const rows = await sql`
    UPDATE x402_providers SET
      name = ${next.name}, description = ${next.description}, category = ${next.category}, base_url = ${next.base_url},
      status = ${next.status}, default_currency = ${next.default_currency}, pricing_model = ${next.pricing_model},
      metadata = ${JSON.stringify(metadata || {})}::jsonb, updated_at = NOW()
    WHERE org_id = ${orgId} AND provider_id = ${providerId}
    RETURNING *`;
  return rows[0] || null;
}

// Resolve a provider row from a free-text provider name/origin (e.g. an x402
// purchase that supplies `provider: "stableenrich.dev"` but no provider_id),
// auto-registering one when none matches so the spend still groups under a real
// provider instead of a null provider_id (which renders blank on Spend → x402).
// Matches an existing provider by slug (derived from the name) or a
// case-insensitive exact name, so a provider the plugin or a prior purchase
// already registered is REUSED rather than duplicated.
export async function resolveProviderByName(sql, orgId, providerName) {
  const name = String(providerName || '').trim();
  if (!name) return null;
  const slug = slugify(name);
  const existing = await sql`
    SELECT * FROM x402_providers
    WHERE org_id = ${orgId} AND (slug = ${slug} OR LOWER(name) = ${name.toLowerCase()})
    ORDER BY created_at ASC
    LIMIT 1`;
  if (existing[0]) return existing[0];
  // No match — register a minimal active provider keyed by the name. base_url is
  // set when the name looks like a bare host so /spend/x402 can link out to it.
  const looksLikeHost = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(name);
  return createProvider(sql, orgId, {
    name,
    slug,
    base_url: looksLikeHost ? `https://${name}` : null,
    category: 'x402',
    status: 'active',
  });
}

// --- Endpoints -------------------------------------------------------------

export async function createEndpoint(sql, orgId, providerId, data = {}) {
  const endpointId = genId('pep');
  const slug = data.slug ? slugify(data.slug) : slugify(data.name || endpointId);
  const rows = await sql`
    INSERT INTO x402_endpoints
      (endpoint_id, org_id, provider_id, name, slug, description, endpoint_url, category, sensitivity_level, default_price, price_unit, enabled, metadata)
    VALUES
      (${endpointId}, ${orgId}, ${providerId}, ${data.name || slug}, ${slug}, ${data.description || null}, ${data.endpoint_url || null},
       ${data.category || 'research'}, ${data.sensitivity_level || 'low'}, ${data.default_price ?? null}, ${data.price_unit || 'per_call'},
       ${data.enabled === false ? 0 : 1}, ${JSON.stringify(data.metadata || {})}::jsonb)
    RETURNING *`;
  return rows[0] || null;
}

export async function listEndpoints(sql, orgId, providerId) {
  return sql`SELECT * FROM x402_endpoints WHERE org_id = ${orgId} AND provider_id = ${providerId} ORDER BY created_at DESC`;
}

export async function getEndpoint(sql, orgId, endpointId) {
  const rows = await sql`SELECT * FROM x402_endpoints WHERE org_id = ${orgId} AND endpoint_id = ${endpointId} LIMIT 1`;
  return rows[0] || null;
}

// --- Purchases (1:1 with action_records.action_id) -------------------------

export async function createPurchase(sql, orgId, actionId, data = {}) {
  const rows = await sql`
    INSERT INTO x402_purchases
      (action_id, org_id, provider_id, endpoint_id, agent_id, spend_amount, currency, payment_method,
       wallet_reference, payment_reference, purchase_reason, context_gap, alternatives_considered, expected_value,
       execution_status, confidence_score)
    VALUES
      (${actionId}, ${orgId}, ${data.provider_id || null}, ${data.endpoint_id || null}, ${data.agent_id || null},
       ${data.spend_amount ?? 0}, ${data.currency || 'USDC'}, ${data.payment_method || null},
       ${data.wallet_reference || null}, ${data.payment_reference || null}, ${data.purchase_reason || null},
       ${data.context_gap || null}, ${data.alternatives_considered || null}, ${data.expected_value || null},
       ${data.execution_status || 'pending'}, ${data.confidence_score ?? null})
    ON CONFLICT (action_id) DO UPDATE SET
       provider_id = EXCLUDED.provider_id, endpoint_id = EXCLUDED.endpoint_id, spend_amount = EXCLUDED.spend_amount
    RETURNING *`;
  return rows[0] || null;
}

export async function getPurchase(sql, orgId, actionId) {
  const rows = await sql`SELECT * FROM x402_purchases WHERE org_id = ${orgId} AND action_id = ${actionId} LIMIT 1`;
  return rows[0] || null;
}

export async function listPurchases(sql, orgId, { providerId } = {}) {
  if (providerId) {
    return sql`SELECT * FROM x402_purchases WHERE org_id = ${orgId} AND provider_id = ${providerId} ORDER BY created_at DESC`;
  }
  return sql`SELECT * FROM x402_purchases WHERE org_id = ${orgId} ORDER BY created_at DESC`;
}

export async function setPurchaseOutcome(sql, orgId, actionId, data = {}) {
  const rows = await sql`
    UPDATE x402_purchases SET
      execution_status = ${data.execution_status || 'succeeded'},
      result_summary = ${data.result_summary || null},
      result_reference = ${data.result_reference || null},
      value_score = ${data.value_score ?? null},
      operator_feedback = ${data.operator_feedback || null},
      failure_reason = ${data.failure_reason || null},
      completed_at = NOW()
    WHERE org_id = ${orgId} AND action_id = ${actionId}
    RETURNING *`;
  return rows[0] || null;
}

// --- Aggregation (FinOps Fleet lens) ---------------------------------------

const X402_PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

export async function getX402SpendAggregation(sql, orgId, { period = '30d' } = {}) {
  const days = X402_PERIOD_DAYS[period] ?? 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  // Exclude FAILED purchases from spend: a failed x402 call means no money moved,
  // so counting it would overstate Fleet/x402 spend. succeeded/partial/approved/
  // pending are retained (committed or settled intent). Operator decision
  // 2026-06-05: "exclude failed only".
  const [totals] = await sql`
    SELECT COALESCE(SUM(spend_amount), 0)::real AS total_spend_usd, COUNT(*)::integer AS purchase_count
    FROM x402_purchases
    WHERE org_id = ${orgId} AND created_at::timestamptz >= ${since}::timestamptz AND execution_status <> 'failed'`;
  const byDay = await sql`
    SELECT DATE(created_at::timestamptz) AS date, COALESCE(SUM(spend_amount), 0)::real AS spend_usd, COUNT(*)::integer AS purchase_count
    FROM x402_purchases
    WHERE org_id = ${orgId} AND created_at::timestamptz >= ${since}::timestamptz AND execution_status <> 'failed'
    GROUP BY DATE(created_at::timestamptz)
    ORDER BY date DESC`;
  const byProvider = await sql`
    SELECT provider_id, COALESCE(SUM(spend_amount), 0)::real AS spend_usd, COUNT(*)::integer AS purchase_count
    FROM x402_purchases
    WHERE org_id = ${orgId} AND created_at::timestamptz >= ${since}::timestamptz AND execution_status <> 'failed'
    GROUP BY provider_id
    ORDER BY spend_usd DESC`;
  return {
    period,
    total_spend_usd: totals?.total_spend_usd ?? 0,
    purchase_count: totals?.purchase_count ?? 0,
    by_day: byDay,
    by_provider: byProvider,
  };
}
