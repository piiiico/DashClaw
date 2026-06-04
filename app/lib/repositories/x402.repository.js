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
