# x402 Spend Governance — Foundation (Plan 1 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a fleet agent acquire a paid x402 capability under DashClaw governance — provider registry + a governed, recorded, approvable, outcome-scored purchase — without DashClaw ever holding a wallet or calling a provider.

**Architecture:** A purchase is a subtype of the existing `action_records` lifecycle (`action_type: 'x402_purchase'`), so it reuses guard → create → approve → outcome → artifact unchanged. Net-new is three raw-SQL tables (`x402_providers`, `x402_endpoints`, `x402_purchases` keyed 1:1 by `action_id`), one repository, one new guard `policy_type` (`x402_spend_limit`), provider/endpoint/purchase routes, and mirrored Node+Python SDK methods. Modeled 1:1 on the shipped Agent Registry (`drizzle/0019_agent_registry.sql`). Spend/settlement and provider adapters stay agent-side (governance boundary).

**Tech Stack:** Next.js 16 App Router (JS, no TS in DashClaw app), Neon/Postgres via tagged-template `sql`, raw-SQL Drizzle migrations, vitest (mocked `sql`), Node SDK (`sdk/dashclaw.js`, camelCase) + Python SDK (`sdk-python/dashclaw/client.py`, snake_case).

---

## Preconditions (read before starting)

1. **Re-verified against HEAD on 2026-06-04 after the big push (commits through `347b7ea7`).** The concurrent reputation/registry/Group-A + session_id-stamping work has landed on `main`; the timing block is lifted. All core assumptions re-verified **PASS** except four drifts, fixed inline below: migration number is **0021** (Task 1); `slugify` is **inlined**, not imported (Task 2); `getSql()` is **synchronous** — no `await` (Tasks 6–9); repository tests use a plain **`vi.fn()`** sql, not `createSqlMock` (Tasks 2–4). The Node `_request(path, method, body, params)` and Python `_request(..., **kwargs)` accept the plan's positional / `json=` calls unchanged. No pre-existing x402 code — no collision.
2. Source spec: `docs/superpowers/specs/2026-06-04-x402-spend-governance-design.md`. This plan implements its Phase 1 only; Phases 2+ (spend dashboard, provider-registry UI, approval-queue UI, value-scoring analytics, provider ranking, the full 6-surface doc rollout) are follow-on plans.
3. **Decisions locked by this plan** (resolving the spec's §10 open questions): purchase modeled as a **detail table keyed by `action_id`** (not columns on `action_records`); x402 policy is a **new `guard_policies` policy_type**, no `x402_policies`/`x402_approvals` tables; **raw-SQL migration, no `pgTable` in `schema/schema.js`** (matching the Agent Registry choice); id prefixes `prov_`, `pep_`; seed provider category = research (Exa first).
4. After the migration task, you MUST run `npm run db:migrate` against your local DB or every authenticated request will 401 (stale-schema trap).
5. **Reconciled with `docs/rfcs/0002-costclaw-dashclaw-integration.md` on 2026-06-04 — NO CONFLICT.** RFC 0002 is a different domain (Claude Code FinOps / developer-setup audit as an open-core paid add-on), touches no Plan-1 surface (no shared tables/routes/SDK methods/guard policy), and explicitly cites this x402 spec as complementary (its §7 says the shared `@claw/engine` "actively helps x402 by giving one canonical pricing source"). x402 does **not** depend on `@claw/engine` — x402 spend is the agent-reported micropayment amount, not token-derived cost. **One IA note for Plan 2 (dashboard):** DashClaw will then have three distinct "spend" concepts — x402 purchase spend, existing Agent Spend (`cost_estimate`), and CostClaw "recoverable spend" — coordinate the vocabulary so the operator isn't confused. Not a Plan-1 concern.

## File Structure

| File | Responsibility | Create/Modify |
|---|---|---|
| `drizzle/00NN_x402_spend_governance.sql` | Three x402 tables (use next free migration number) | Create |
| `app/lib/repositories/x402.repository.js` | All x402 SQL (providers, endpoints, purchases), org-scoped | Create |
| `app/lib/guard.js` | Add `x402_spend_limit` case to `evaluatePolicy` switch | Modify |
| `app/api/x402/providers/route.js` | GET list / POST create provider | Create |
| `app/api/x402/providers/[id]/route.js` | GET detail / PATCH update provider | Create |
| `app/api/x402/providers/[id]/endpoints/route.js` | GET list / POST create endpoint | Create |
| `app/api/x402/purchases/route.js` | POST governed purchase (guard+action+detail) / GET list | Create |
| `sdk/dashclaw.js` | Node SDK x402 methods | Modify |
| `sdk-python/dashclaw/client.py` | Python SDK x402 methods | Modify |
| `__tests__/unit/x402-repository.test.js` | Repository unit tests | Create |
| `__tests__/unit/x402-guard-policy.test.js` | Guard `x402_spend_limit` evaluator tests | Create |
| `__tests__/unit/x402-providers.route.test.js` | Provider/endpoint route tests | Create |
| `__tests__/unit/x402-purchases.route.test.js` | Governed-purchase route tests | Create |
| `__tests__/unit/sdk-x402.test.js` | Node SDK wrapper tests | Create |
| Docs (6-surface checklist) | See Task 13 | Modify |

Test commands: single file `npx vitest run __tests__/unit/<file>`; full suite `npx vitest run`; lint `npm run lint`; app build `npx next build`.

---

### Task 1: Migration — the three x402 tables

**Files:**
- Create: `drizzle/0021_x402_spend_governance.sql` (verified 2026-06-04: highest existing migration is `0020_session_action_link.sql`, so **0021** is the next free number)

- [ ] **Step 1: Write the migration**

Create `drizzle/0021_x402_spend_governance.sql` (next free number, verified against HEAD):

```sql
-- x402 spend governance: provider registry + purchase detail (keyed 1:1 to action_records.action_id)
CREATE TABLE IF NOT EXISTS "x402_providers" (
  "provider_id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'research',
  "base_url" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "default_currency" TEXT NOT NULL DEFAULT 'USDC',
  "pricing_model" TEXT,
  "metadata" JSONB DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "x402_providers_org_slug_unique" ON "x402_providers" ("org_id", "slug");

CREATE TABLE IF NOT EXISTS "x402_endpoints" (
  "endpoint_id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "provider_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "endpoint_url" TEXT,
  "category" TEXT NOT NULL DEFAULT 'research',
  "sensitivity_level" TEXT NOT NULL DEFAULT 'low',
  "default_price" REAL,
  "price_unit" TEXT DEFAULT 'per_call',
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "metadata" JSONB DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_x402_endpoints_provider" ON "x402_endpoints" ("org_id", "provider_id");
CREATE UNIQUE INDEX IF NOT EXISTS "x402_endpoints_provider_slug_unique" ON "x402_endpoints" ("org_id", "provider_id", "slug");

CREATE TABLE IF NOT EXISTS "x402_purchases" (
  "action_id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "provider_id" TEXT,
  "endpoint_id" TEXT,
  "agent_id" TEXT,
  "spend_amount" REAL NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USDC',
  "payment_method" TEXT,
  "wallet_reference" TEXT,
  "payment_reference" TEXT,
  "purchase_reason" TEXT,
  "context_gap" TEXT,
  "alternatives_considered" TEXT,
  "expected_value" TEXT,
  "execution_status" TEXT NOT NULL DEFAULT 'pending',
  "result_summary" TEXT,
  "result_reference" TEXT,
  "value_score" REAL,
  "confidence_score" REAL,
  "operator_feedback" TEXT,
  "failure_reason" TEXT,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "completed_at" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "idx_x402_purchases_provider" ON "x402_purchases" ("org_id", "provider_id", "created_at");
```

- [ ] **Step 2: Apply the migration**

Run: `npm run db:migrate`
Expected: completes without error; idempotent (re-run is a no-op).

- [ ] **Step 3: Verify tables exist**

Run a quick check (psql or a one-off `node` script using the project's `sql`): `SELECT to_regclass('x402_providers'), to_regclass('x402_endpoints'), to_regclass('x402_purchases');`
Expected: three non-null regclass values.

- [ ] **Step 4: Commit**

```bash
git add drizzle/0021_x402_spend_governance.sql
git commit -m "feat(x402): add provider/endpoint/purchase tables"
```

---

### Task 2: Repository — provider CRUD

**Files:**
- Create: `app/lib/repositories/x402.repository.js`
- Test: `__tests__/unit/x402-repository.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProvider, listProviders, getProvider, updateProvider,
} from '@/lib/repositories/x402.repository.js';

// Verified 2026-06-04: __tests__/helpers.js `createSqlMock` uses a pre-seeded
// taggedResponses/queryCalls shape (NOT vi.fn) and exposes `.taggedCalls`, not
// `.mock.calls`. For repository SQL tests we use a plain vi.fn() as the
// tagged-template `sql` — it supports .mockResolvedValueOnce and exposes
// .mock.calls (the template strings array is at calls[0][0]).
let sql;
beforeEach(() => { sql = vi.fn(); });

describe('x402 provider repository', () => {
  it('createProvider inserts an org-scoped row with a prov_ id and slug', async () => {
    sql.mockResolvedValueOnce([{ provider_id: 'prov_x', org_id: 'org_1', name: 'Exa', slug: 'exa' }]);
    const row = await createProvider(sql, 'org_1', { name: 'Exa' });
    expect(row.provider_id).toBe('prov_x');
    const text = sql.mock.calls[0][0].join('?');
    expect(text).toContain('INSERT INTO x402_providers');
  });

  it('listProviders filters by org and optional status', async () => {
    sql.mockResolvedValueOnce([{ provider_id: 'prov_x' }]);
    const rows = await listProviders(sql, 'org_1', { status: 'active' });
    expect(rows).toHaveLength(1);
  });

  it('getProvider returns null when missing', async () => {
    sql.mockResolvedValueOnce([]);
    expect(await getProvider(sql, 'org_1', 'prov_missing')).toBeNull();
  });

  it('updateProvider patches only whitelisted fields', async () => {
    sql.mockResolvedValueOnce([{ provider_id: 'prov_x', name: 'Exa', status: 'active', category: 'research', base_url: null, description: null, pricing_model: null, default_currency: 'USDC', metadata: '{}' }]);
    sql.mockResolvedValueOnce([{ provider_id: 'prov_x', status: 'disabled' }]);
    const row = await updateProvider(sql, 'org_1', 'prov_x', { status: 'disabled' });
    expect(row.status).toBe('disabled');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/x402-repository.test.js`
Expected: FAIL — cannot import from `x402.repository.js` (module not found).

- [ ] **Step 3: Write minimal implementation**

```javascript
import crypto from 'node:crypto';

// Verified 2026-06-04: there is NO shared slugify export. The house pattern is an
// inline per-repository copy (registered-agents / capabilities / workflow-templates
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
```

> Verified 2026-06-04: `slugify` is inlined above (no shared export exists). `crypto.randomUUID()` + `${prefix}_` id minting matches the registry repo.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/x402-repository.test.js`
Expected: PASS (provider tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/repositories/x402.repository.js __tests__/unit/x402-repository.test.js
git commit -m "feat(x402): provider repository CRUD"
```

---

### Task 3: Repository — endpoint CRUD

**Files:**
- Modify: `app/lib/repositories/x402.repository.js`
- Test: `__tests__/unit/x402-repository.test.js` (add a describe block)

- [ ] **Step 1: Write the failing test** (append to the test file)

```javascript
import { createEndpoint, listEndpoints } from '@/lib/repositories/x402.repository.js';

describe('x402 endpoint repository', () => {
  it('createEndpoint inserts a pep_ row under a provider', async () => {
    sql.mockResolvedValueOnce([{ endpoint_id: 'pep_1', provider_id: 'prov_x', slug: 'search' }]);
    const row = await createEndpoint(sql, 'org_1', 'prov_x', { name: 'Search' });
    expect(row.endpoint_id).toBe('pep_1');
  });

  it('listEndpoints scopes by org + provider', async () => {
    sql.mockResolvedValueOnce([{ endpoint_id: 'pep_1' }]);
    const rows = await listEndpoints(sql, 'org_1', 'prov_x');
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/x402-repository.test.js`
Expected: FAIL — `createEndpoint` is not exported.

- [ ] **Step 3: Write minimal implementation** (append to `x402.repository.js`)

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/x402-repository.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/repositories/x402.repository.js __tests__/unit/x402-repository.test.js
git commit -m "feat(x402): endpoint repository CRUD"
```

---

### Task 4: Repository — purchase detail (keyed by action_id)

**Files:**
- Modify: `app/lib/repositories/x402.repository.js`
- Test: `__tests__/unit/x402-repository.test.js`

- [ ] **Step 1: Write the failing test** (append)

```javascript
import { createPurchase, listPurchases, getPurchase, setPurchaseOutcome } from '@/lib/repositories/x402.repository.js';

describe('x402 purchase repository', () => {
  it('createPurchase upserts a detail row keyed by action_id', async () => {
    sql.mockResolvedValueOnce([{ action_id: 'act_1', spend_amount: 0.05, provider_id: 'prov_x' }]);
    const row = await createPurchase(sql, 'org_1', 'act_1', { provider_id: 'prov_x', spend_amount: 0.05, purchase_reason: 'gap' });
    expect(row.action_id).toBe('act_1');
  });

  it('setPurchaseOutcome records execution result + value score', async () => {
    sql.mockResolvedValueOnce([{ action_id: 'act_1', execution_status: 'succeeded', value_score: 0.8 }]);
    const row = await setPurchaseOutcome(sql, 'org_1', 'act_1', { execution_status: 'succeeded', value_score: 0.8, result_summary: 'ok' });
    expect(row.execution_status).toBe('succeeded');
  });

  it('listPurchases is org-scoped', async () => {
    sql.mockResolvedValueOnce([{ action_id: 'act_1' }]);
    expect(await listPurchases(sql, 'org_1', {})).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/x402-repository.test.js`
Expected: FAIL — `createPurchase` not exported.

- [ ] **Step 3: Write minimal implementation** (append)

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/x402-repository.test.js`
Expected: PASS (all repository describes).

- [ ] **Step 5: Commit**

```bash
git add app/lib/repositories/x402.repository.js __tests__/unit/x402-repository.test.js
git commit -m "feat(x402): purchase detail repository (keyed by action_id)"
```

---

### Task 5: Guard — `x402_spend_limit` policy type

**Files:**
- Modify: `app/lib/guard.js` (add a `case` to the `evaluatePolicy` switch — locate it near the existing `risk_threshold` / `require_approval` cases)
- Test: `__tests__/unit/x402-guard-policy.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '@/lib/guard.js';

const policy = { policy_type: 'x402_spend_limit' };

describe('evaluatePolicy: x402_spend_limit', () => {
  it('blocks a provider not in the allowed list', async () => {
    const rules = { allowed_providers: ['exa'], approval_threshold: 5, max_spend_usd: 50 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'sketchy', cost_estimate: 0.1 });
    expect(out?.action).toBe('block');
  });

  it('requires approval over the threshold', async () => {
    const rules = { allowed_providers: [], approval_threshold: 1, max_spend_usd: 50 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'exa', cost_estimate: 2 });
    expect(out?.action).toBe('require_approval');
  });

  it('blocks over the hard max', async () => {
    const rules = { allowed_providers: [], approval_threshold: 1, max_spend_usd: 5 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'exa', cost_estimate: 10 });
    expect(out?.action).toBe('block');
  });

  it('allows (returns null) under all limits', async () => {
    const rules = { allowed_providers: ['exa'], approval_threshold: 5, max_spend_usd: 50 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'exa', cost_estimate: 0.1 });
    expect(out).toBeNull();
  });

  it('ignores non-purchase actions', async () => {
    const out = await evaluatePolicy(policy, { max_spend_usd: 0 }, { action_type: 'build', cost_estimate: 999 });
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/x402-guard-policy.test.js`
Expected: FAIL — the switch returns `null` (default) for `x402_spend_limit`, so `require_approval`/`block` assertions fail.

- [ ] **Step 3: Write minimal implementation** — add this `case` inside the `evaluatePolicy` switch in `app/lib/guard.js`:

```javascript
    case 'x402_spend_limit': {
      if (context.action_type !== 'x402_purchase') return null;
      const maxSpend = rules.max_spend_usd ?? Infinity;
      const approvalThreshold = rules.approval_threshold ?? Infinity;
      const allowed = Array.isArray(rules.allowed_providers) ? rules.allowed_providers : [];
      const blocked = Array.isArray(rules.blocked_providers) ? rules.blocked_providers : [];
      const provider = context.provider || context.vendor || 'unknown';
      const spend = Number(context.cost_estimate ?? context.cost ?? 0) || 0;

      if (blocked.includes(provider)) {
        return { action: 'block', reason: `Provider "${provider}" is blocked by policy` };
      }
      if (allowed.length > 0 && !allowed.includes(provider)) {
        return { action: 'block', reason: `Provider "${provider}" not in approved list` };
      }
      if (spend > maxSpend) {
        return { action: 'block', reason: `Spend $${spend.toFixed(4)} exceeds max $${maxSpend}` };
      }
      if (spend >= approvalThreshold) {
        return { action: 'require_approval', reason: `Spend $${spend.toFixed(4)} >= approval threshold $${approvalThreshold}` };
      }
      return null;
    }
```

> Verify the surrounding switch is `async` / the function signature matches the existing `evaluatePolicy(policy, rules, context, sql, orgId, effectiveRiskScore)`. Add the case alongside the others; do not change other cases.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/x402-guard-policy.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/guard.js __tests__/unit/x402-guard-policy.test.js
git commit -m "feat(x402): x402_spend_limit guard policy type"
```

---

### Task 6: Route — provider list/create

**Files:**
- Create: `app/api/x402/providers/route.js`
- Test: `__tests__/unit/x402-providers.route.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSql, mockCreateProvider, mockListProviders } = vi.hoisted(() => ({
  mockSql: vi.fn(async () => []),
  mockCreateProvider: vi.fn(),
  mockListProviders: vi.fn(),
}));
vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1' }));
vi.mock('@/lib/repositories/x402.repository.js', () => ({
  createProvider: mockCreateProvider,
  listProviders: mockListProviders,
}));

const { GET, POST } = await import('@/api/x402/providers/route.js');
function req(method, body) {
  return new Request('http://localhost/api/x402/providers', {
    method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => vi.clearAllMocks());

describe('/api/x402/providers', () => {
  it('GET lists providers', async () => {
    mockListProviders.mockResolvedValue([{ provider_id: 'prov_x' }]);
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    expect((await res.json()).providers).toHaveLength(1);
  });

  it('POST 400 when name missing', async () => {
    const res = await POST(req('POST', {}));
    expect(res.status).toBe(400);
  });

  it('POST 201 creates a provider', async () => {
    mockCreateProvider.mockResolvedValue({ provider_id: 'prov_x', name: 'Exa' });
    const res = await POST(req('POST', { name: 'Exa' }));
    expect(res.status).toBe(201);
    expect((await res.json()).provider.provider_id).toBe('prov_x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/x402-providers.route.test.js`
Expected: FAIL — route module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { createProvider, listProviders } from '../../../lib/repositories/x402.repository.js';

/** GET /api/x402/providers — list providers (org-scoped). */
export async function GET(request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const status = new URL(request.url).searchParams.get('status') || undefined;
    const providers = await listProviders(sql, orgId, { status });
    return NextResponse.json({ providers });
  } catch (err) {
    console.error('[X402/PROVIDERS] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/x402/providers — register a paid x402 provider. */
export async function POST(request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const body = await request.json().catch(() => ({}));
    if (!body?.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const provider = await createProvider(sql, orgId, body);
    return NextResponse.json({ provider }, { status: 201 });
  } catch (err) {
    console.error('[X402/PROVIDERS] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

> Verified 2026-06-04: `getSql()` in `app/lib/db.js` is **synchronous** — call `const sql = getSql();` (no `await`), matching the actions/artifacts routes. `getOrgId(request)` in `app/lib/org.js` returns the `x-org-id` header or `'org_default'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/x402-providers.route.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/x402/providers/route.js __tests__/unit/x402-providers.route.test.js
git commit -m "feat(x402): provider list/create route"
```

---

### Task 7: Route — provider detail/update

**Files:**
- Create: `app/api/x402/providers/[id]/route.js`
- Test: `__tests__/unit/x402-providers.route.test.js` (add describe)

- [ ] **Step 1: Write the failing test** (append)

```javascript
const { mockGetProvider, mockUpdateProvider, mockListEndpoints } = vi.hoisted(() => ({
  mockGetProvider: vi.fn(), mockUpdateProvider: vi.fn(), mockListEndpoints: vi.fn(),
}));
// extend the existing repository mock to also export these:
vi.mock('@/lib/repositories/x402.repository.js', () => ({
  createProvider: mockCreateProvider, listProviders: mockListProviders,
  getProvider: mockGetProvider, updateProvider: mockUpdateProvider, listEndpoints: mockListEndpoints,
}));
const detail = await import('@/api/x402/providers/[id]/route.js');

describe('/api/x402/providers/[id]', () => {
  it('GET 404 when missing', async () => {
    mockGetProvider.mockResolvedValue(null);
    const res = await detail.GET(req('GET'), { params: Promise.resolve({ id: 'prov_missing' }) });
    expect(res.status).toBe(404);
  });
  it('GET 200 returns provider + endpoints', async () => {
    mockGetProvider.mockResolvedValue({ provider_id: 'prov_x' });
    mockListEndpoints.mockResolvedValue([{ endpoint_id: 'pep_1' }]);
    const res = await detail.GET(req('GET'), { params: Promise.resolve({ id: 'prov_x' }) });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.provider.provider_id).toBe('prov_x');
    expect(j.endpoints).toHaveLength(1);
  });
  it('PATCH 200 updates', async () => {
    mockUpdateProvider.mockResolvedValue({ provider_id: 'prov_x', status: 'disabled' });
    const res = await detail.PATCH(req('PATCH', { status: 'disabled' }), { params: Promise.resolve({ id: 'prov_x' }) });
    expect(res.status).toBe(200);
  });
});
```

> Because `vi.mock` is hoisted and deduped per module path, merge these new exports into the single `vi.mock('@/lib/repositories/x402.repository.js', …)` factory at the top of the file rather than declaring it twice.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/x402-providers.route.test.js`
Expected: FAIL — `[id]/route.js` not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db.js';
import { getOrgId } from '../../../../lib/org.js';
import { getProvider, updateProvider, listEndpoints } from '../../../../lib/repositories/x402.repository.js';

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const orgId = getOrgId(request);
    const sql = getSql();
    const provider = await getProvider(sql, orgId, id);
    if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    const endpoints = await listEndpoints(sql, orgId, id);
    return NextResponse.json({ provider, endpoints });
  } catch (err) {
    console.error('[X402/PROVIDERS/:id] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const orgId = getOrgId(request);
    const sql = getSql();
    const patch = await request.json().catch(() => ({}));
    const provider = await updateProvider(sql, orgId, id, patch);
    if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    return NextResponse.json({ provider });
  } catch (err) {
    console.error('[X402/PROVIDERS/:id] PATCH error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/x402-providers.route.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/x402/providers/[id]/route.js" __tests__/unit/x402-providers.route.test.js
git commit -m "feat(x402): provider detail/update route"
```

---

### Task 8: Route — provider endpoints list/create

**Files:**
- Create: `app/api/x402/providers/[id]/endpoints/route.js`
- Test: `__tests__/unit/x402-providers.route.test.js` (add describe)

- [ ] **Step 1: Write the failing test** (append; add `createEndpoint` to the merged repo mock factory)

```javascript
const ep = await import('@/api/x402/providers/[id]/endpoints/route.js');
describe('/api/x402/providers/[id]/endpoints', () => {
  it('GET lists endpoints', async () => {
    mockListEndpoints.mockResolvedValue([{ endpoint_id: 'pep_1' }]);
    const res = await ep.GET(req('GET'), { params: Promise.resolve({ id: 'prov_x' }) });
    expect(res.status).toBe(200);
    expect((await res.json()).endpoints).toHaveLength(1);
  });
  it('POST 400 when name missing', async () => {
    const res = await ep.POST(req('POST', {}), { params: Promise.resolve({ id: 'prov_x' }) });
    expect(res.status).toBe(400);
  });
  it('POST 201 creates an endpoint', async () => {
    mockCreateEndpoint.mockResolvedValue({ endpoint_id: 'pep_1', name: 'Search' });
    const res = await ep.POST(req('POST', { name: 'Search' }), { params: Promise.resolve({ id: 'prov_x' }) });
    expect(res.status).toBe(201);
  });
});
```

(Add `mockCreateEndpoint: vi.fn()` to the hoisted mocks and `createEndpoint: mockCreateEndpoint` to the repo mock factory.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/x402-providers.route.test.js`
Expected: FAIL — endpoints route not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db.js';
import { getOrgId } from '../../../../../lib/org.js';
import { createEndpoint, listEndpoints } from '../../../../../lib/repositories/x402.repository.js';

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const orgId = getOrgId(request);
    const sql = getSql();
    const endpoints = await listEndpoints(sql, orgId, id);
    return NextResponse.json({ endpoints });
  } catch (err) {
    console.error('[X402/PROVIDERS/:id/ENDPOINTS] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const orgId = getOrgId(request);
    const sql = getSql();
    const body = await request.json().catch(() => ({}));
    if (!body?.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const endpoint = await createEndpoint(sql, orgId, id, body);
    return NextResponse.json({ endpoint }, { status: 201 });
  } catch (err) {
    console.error('[X402/PROVIDERS/:id/ENDPOINTS] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/x402-providers.route.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/x402/providers/[id]/endpoints/route.js" __tests__/unit/x402-providers.route.test.js
git commit -m "feat(x402): provider endpoints route"
```

---

### Task 9: Route — governed purchase (the core loop)

This route runs the same guard → create-action → record-detail loop the actions route uses, but enforces the x402 rationale fields and writes the purchase detail. It returns `{ action, purchase, decision }` with status 201 (running), 202 (pending_approval), or 403 (blocked).

**Files:**
- Create: `app/api/x402/purchases/route.js`
- Test: `__tests__/unit/x402-purchases.route.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  sql: vi.fn(async () => []),
  evaluateGuard: vi.fn(),
  createActionRecord: vi.fn(),
  createBlockedActionRecord: vi.fn(),
  createPurchase: vi.fn(),
  listPurchases: vi.fn(),
}));
vi.mock('@/lib/db.js', () => ({ getSql: () => m.sql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1' }));
vi.mock('@/lib/guard.js', () => ({ evaluateGuard: m.evaluateGuard }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  createActionRecord: m.createActionRecord,
  createBlockedActionRecord: m.createBlockedActionRecord,
}));
vi.mock('@/lib/repositories/x402.repository.js', () => ({
  createPurchase: m.createPurchase, listPurchases: m.listPurchases,
}));

const { POST } = await import('@/api/x402/purchases/route.js');
function req(body) {
  return new Request('http://localhost/api/x402/purchases', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
const valid = { agent_id: 'a1', provider: 'exa', declared_goal: 'research', cost_estimate: 0.05, purchase_reason: 'gap', context_gap: 'no current data', expected_value: 'fresh sources' };

beforeEach(() => vi.clearAllMocks());

describe('POST /api/x402/purchases', () => {
  it('400 when rationale fields are missing', async () => {
    const res = await POST(req({ agent_id: 'a1', provider: 'exa' }));
    expect(res.status).toBe(400);
  });

  it('403 + blocked action when guard blocks', async () => {
    m.evaluateGuard.mockResolvedValue({ decision: 'block', reason: 'not allowed' });
    m.createBlockedActionRecord.mockResolvedValue({ action_id: 'act_b', status: 'blocked' });
    const res = await POST(req(valid));
    expect(res.status).toBe(403);
    expect(m.createPurchase).not.toHaveBeenCalled();
  });

  it('202 pending_approval when guard requires approval', async () => {
    m.evaluateGuard.mockResolvedValue({ decision: 'require_approval', reason: 'over threshold' });
    m.createActionRecord.mockResolvedValue({ action_id: 'act_p', status: 'pending_approval' });
    m.createPurchase.mockResolvedValue({ action_id: 'act_p' });
    const res = await POST(req(valid));
    expect(res.status).toBe(202);
    const j = await res.json();
    expect(j.action.status).toBe('pending_approval');
    expect(m.createPurchase).toHaveBeenCalledWith(m.sql, 'org_1', 'act_p', expect.objectContaining({ provider_id: undefined, spend_amount: 0.05 }));
  });

  it('201 running when guard allows', async () => {
    m.evaluateGuard.mockResolvedValue({ decision: 'allow' });
    m.createActionRecord.mockResolvedValue({ action_id: 'act_a', status: 'running' });
    m.createPurchase.mockResolvedValue({ action_id: 'act_a' });
    const res = await POST(req(valid));
    expect(res.status).toBe(201);
    expect((await res.json()).action.status).toBe('running');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/x402-purchases.route.test.js`
Expected: FAIL — purchases route not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { evaluateGuard } from '../../../lib/guard.js';
import { createActionRecord, createBlockedActionRecord } from '../../../lib/repositories/actions.repository.js';
import { createPurchase, listPurchases } from '../../../lib/repositories/x402.repository.js';

const REQUIRED = ['agent_id', 'provider', 'declared_goal', 'purchase_reason', 'context_gap', 'expected_value'];

/** GET /api/x402/purchases — list purchases (org-scoped). */
export async function GET(request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const providerId = new URL(request.url).searchParams.get('provider_id') || undefined;
    const purchases = await listPurchases(sql, orgId, { providerId });
    return NextResponse.json({ purchases });
  } catch (err) {
    console.error('[X402/PURCHASES] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/x402/purchases — govern + record a paid acquisition.
 * Runs guard, then either blocks, holds for approval, or creates a running
 * purchase action plus its x402_purchases detail row. The agent executes the
 * actual x402 call itself (boundary); it then reports outcome via the existing
 * POST /api/actions/[actionId]/outcome and writes a result artifact.
 */
export async function POST(request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const body = await request.json().catch(() => ({}));

    const missing = REQUIRED.filter((k) => body[k] == null || body[k] === '');
    if (missing.length) {
      return NextResponse.json({ error: `Missing required fields: ${missing.join(', ')}` }, { status: 400 });
    }

    const action_id = `act_${crypto.randomUUID()}`;
    const timestamp_start = new Date().toISOString();
    const guardContext = {
      action_type: 'x402_purchase',
      agent_id: body.agent_id,
      provider: body.provider,
      declared_goal: body.declared_goal,
      cost_estimate: Number(body.cost_estimate ?? body.spend_amount ?? 0) || 0,
      risk_score: body.risk_score || 0,
    };

    const guardDecision = await evaluateGuard(orgId, guardContext, sql);

    if (guardDecision.decision === 'block') {
      const blocked = await createBlockedActionRecord(sql, {
        orgId, action_id,
        data: { ...body, action_type: 'x402_purchase' },
        guardDecision, signature: null, verified: false, timestamp_start,
      });
      return NextResponse.json({ action: blocked, decision: guardDecision }, { status: 403 });
    }

    const isPending = guardDecision.decision === 'require_approval';
    const actionStatus = isPending ? 'pending_approval' : 'running';

    const action = await createActionRecord(sql, {
      orgId, action_id,
      data: {
        agent_id: body.agent_id,
        agent_name: body.agent_name,
        action_type: 'x402_purchase',
        declared_goal: body.declared_goal,
        reasoning: body.purchase_reason,
        input_summary: body.context_gap,
        risk_score: body.risk_score || 0,
      },
      actionStatus,
      costEstimate: guardContext.cost_estimate,
      signature: null, verified: false, timestamp_start,
    });

    const purchase = await createPurchase(sql, orgId, action_id, {
      provider_id: body.provider_id,
      endpoint_id: body.endpoint_id,
      agent_id: body.agent_id,
      spend_amount: guardContext.cost_estimate,
      currency: body.currency,
      payment_method: body.payment_method,
      wallet_reference: body.wallet_reference,
      purchase_reason: body.purchase_reason,
      context_gap: body.context_gap,
      alternatives_considered: body.alternatives_considered,
      expected_value: body.expected_value,
      confidence_score: body.confidence_score,
      execution_status: isPending ? 'pending' : 'approved',
    });

    return NextResponse.json({ action, purchase, decision: guardDecision }, { status: isPending ? 202 : 201 });
  } catch (err) {
    console.error('[X402/PURCHASES] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

> Verified 2026-06-04: `createBlockedActionRecord(sql, { orgId, action_id, data, guardDecision, signature, verified, timestamp_start })` and `createActionRecord(sql, { orgId, action_id, data, actionStatus, costEstimate, signature, verified, timestamp_start })` match these calls exactly (`app/lib/repositories/actions.repository.js`). **Key point:** guard does NOT auto-populate spend — this route must put `cost_estimate` and `provider` into the `guardContext` it passes to `evaluateGuard` (it does, above), because the `x402_spend_limit` case reads `context.cost_estimate` and `context.provider`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/x402-purchases.route.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/x402/purchases/route.js __tests__/unit/x402-purchases.route.test.js
git commit -m "feat(x402): governed purchase route (guard + action + detail)"
```

---

### Task 10: Node SDK methods

**Files:**
- Modify: `sdk/dashclaw.js` (add a new section near the Agent Registry methods)
- Test: `__tests__/unit/sdk-x402.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockFetch = vi.fn();
global.fetch = mockFetch;
const { DashClaw } = await import('../../sdk/dashclaw.js');
function lastCall() {
  const [url, opts] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return { url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined };
}
describe('DashClaw — x402 SDK wrappers', () => {
  let claw;
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    claw = new DashClaw({ baseUrl: 'http://localhost:3000', apiKey: 'k', agentId: 'agent-1' });
  });
  it('listProviders GETs /api/x402/providers', async () => {
    await claw.listProviders({ status: 'active' });
    expect(lastCall().method).toBe('GET');
    expect(lastCall().url).toContain('/api/x402/providers');
  });
  it('createProvider POSTs', async () => {
    await claw.createProvider({ name: 'Exa' });
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.body).toEqual({ name: 'Exa' });
  });
  it('recordPurchase POSTs to /api/x402/purchases', async () => {
    await claw.recordPurchase({ agent_id: 'a1', provider: 'exa', declared_goal: 'r', purchase_reason: 'gap', context_gap: 'x', expected_value: 'y', cost_estimate: 0.05 });
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/x402/purchases');
    expect(c.body).toMatchObject({ provider: 'exa', cost_estimate: 0.05 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/sdk-x402.test.js`
Expected: FAIL — `claw.listProviders is not a function`.

- [ ] **Step 3: Write minimal implementation** (add inside the `DashClaw` class in `sdk/dashclaw.js`)

```javascript
  // ---------------------------------------------------------------------------
  // x402 spend governance — provider registry + governed paid acquisition.
  // The agent executes the actual x402 call itself; these methods register
  // providers and record/govern the spend. DashClaw never holds a wallet.
  // ---------------------------------------------------------------------------

  /** GET /api/x402/providers — list registered providers. */
  async listProviders(filters = {}) {
    return this._request('/api/x402/providers', 'GET', null, filters);
  }
  /** POST /api/x402/providers — register a paid provider. */
  async createProvider(data = {}) {
    return this._request('/api/x402/providers', 'POST', data);
  }
  /** GET /api/x402/providers/:id — provider detail + endpoints. */
  async getProvider(id) {
    return this._request(`/api/x402/providers/${id}`, 'GET');
  }
  /** PATCH /api/x402/providers/:id — update a provider. */
  async updateProvider(id, patch = {}) {
    return this._request(`/api/x402/providers/${id}`, 'PATCH', patch);
  }
  /** GET /api/x402/providers/:id/endpoints — list a provider's endpoints. */
  async listProviderEndpoints(id) {
    return this._request(`/api/x402/providers/${id}/endpoints`, 'GET');
  }
  /** POST /api/x402/providers/:id/endpoints — add an endpoint. */
  async createProviderEndpoint(id, data = {}) {
    return this._request(`/api/x402/providers/${id}/endpoints`, 'POST', data);
  }
  /**
   * POST /api/x402/purchases — govern + record a paid acquisition.
   * Required: agent_id, provider, declared_goal, purchase_reason, context_gap, expected_value.
   * Returns { action, purchase, decision }; branch on action.status (running | pending_approval).
   */
  async recordPurchase(data = {}) {
    return this._request('/api/x402/purchases', 'POST', data);
  }
  /** GET /api/x402/purchases — list governed purchases. */
  async listPurchases(filters = {}) {
    return this._request('/api/x402/purchases', 'GET', null, filters);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/sdk-x402.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sdk/dashclaw.js __tests__/unit/sdk-x402.test.js
git commit -m "feat(x402): Node SDK provider + purchase methods"
```

---

### Task 11: Python SDK methods (parity)

**Files:**
- Modify: `sdk-python/dashclaw/client.py` (add an x402 section, mirroring Task 10)

- [ ] **Step 1: Confirm placement** — Verified 2026-06-04: the Python SDK already has the Agent Registry section at `sdk-python/dashclaw/client.py:2035-2065` (snake_case `register_agent` … `invoke_registered_agent`), and `_request(self, path, method='GET', body=None, params=None, json_payload=None, **kwargs)` accepts `json=` and `params=` via `**kwargs` (it pops `json` into `json_payload`). Add the x402 section immediately after the registry section (~line 2065). The registry section IS present at parity — do not re-add registry methods.

- [ ] **Step 2: Write the implementation** (add to `client.py`, mirroring the Agent Registry section style)

```python
    # x402 spend governance -------------------------------------------------

    def list_providers(self, status=None):
        """List registered x402 providers (org-scoped)."""
        params = {}
        if status is not None:
            params["status"] = status
        return self._request("/api/x402/providers", "GET", params=params)

    def create_provider(self, name, **kwargs):
        """Register a paid x402 provider."""
        return self._request("/api/x402/providers", "POST", json={"name": name, **kwargs})

    def get_provider(self, provider_id):
        """Get a provider's detail + endpoints."""
        return self._request(f"/api/x402/providers/{provider_id}", "GET")

    def update_provider(self, provider_id, **patch):
        """Update a provider."""
        return self._request(f"/api/x402/providers/{provider_id}", "PATCH", json=patch)

    def list_provider_endpoints(self, provider_id):
        """List a provider's endpoints."""
        return self._request(f"/api/x402/providers/{provider_id}/endpoints", "GET")

    def create_provider_endpoint(self, provider_id, name, **kwargs):
        """Add an endpoint to a provider."""
        return self._request(f"/api/x402/providers/{provider_id}/endpoints", "POST", json={"name": name, **kwargs})

    def record_purchase(self, agent_id, provider, declared_goal, purchase_reason, context_gap, expected_value, **kwargs):
        """Govern + record a paid acquisition. Branch on action['status']."""
        body = {
            "agent_id": agent_id, "provider": provider, "declared_goal": declared_goal,
            "purchase_reason": purchase_reason, "context_gap": context_gap, "expected_value": expected_value,
            **kwargs,
        }
        return self._request("/api/x402/purchases", "POST", json=body)

    def list_purchases(self, provider_id=None):
        """List governed purchases (org-scoped)."""
        params = {}
        if provider_id is not None:
            params["provider_id"] = provider_id
        return self._request("/api/x402/purchases", "GET", params=params)
```

- [ ] **Step 3: Verify import + run Python tests**

Verified 2026-06-04: tests run via **unittest** (not pytest), through `scripts/run-python-unittest.mjs` → `python -m unittest discover -s sdk-python/tests -p test_*.py`.
Run: `npm run sdk:integration:python`
Expected: PASS. Quick smoke (from `sdk-python/`): `python -c "from dashclaw.client import DashClaw; print(hasattr(DashClaw, 'record_purchase'))"` → `True`.

- [ ] **Step 4: Commit**

```bash
git add sdk-python/dashclaw/client.py
git commit -m "feat(x402): Python SDK parity for provider + purchase methods"
```

---

### Task 12: Result-snapshot artifact convenience (Node SDK)

The result snapshot reuses the existing `POST /api/artifacts` (no new route). Add a thin SDK helper so the agent can attach its result with `source_action_id` in one call.

**Files:**
- Modify: `sdk/dashclaw.js`
- Test: `__tests__/unit/sdk-x402.test.js` (append)

- [ ] **Step 1: Write the failing test** (append)

```javascript
it('recordPurchaseResult POSTs an artifact linked by source_action_id', async () => {
  await claw.recordPurchaseResult('act_a', { summary: '12 sources', data: { count: 12 } });
  const c = lastCall();
  expect(c.method).toBe('POST');
  expect(c.url).toContain('/api/artifacts');
  expect(c.body).toMatchObject({ artifact_type: 'x402_purchase_result', source_action_id: 'act_a' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/sdk-x402.test.js`
Expected: FAIL — `recordPurchaseResult is not a function`.

- [ ] **Step 3: Write minimal implementation** (add to the x402 section in `sdk/dashclaw.js`)

```javascript
  /**
   * POST /api/artifacts — attach the x402 result snapshot to its purchase action.
   * @param {string} actionId - the act_ id from recordPurchase
   * @param {Object} result - { summary?, data?, url? }
   */
  async recordPurchaseResult(actionId, result = {}) {
    return this._request('/api/artifacts', 'POST', {
      artifact_type: 'x402_purchase_result',
      name: `x402 result ${actionId}`,
      description: result.summary || null,
      content_json: result.data ?? {},
      content_url: result.url || null,
      source_action_id: actionId,
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/sdk-x402.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sdk/dashclaw.js __tests__/unit/sdk-x402.test.js
git commit -m "feat(x402): SDK result-snapshot artifact helper"
```

---

### Task 13: Documentation + contract artifacts (the doc tax)

New routes + SDK methods require the full doc checklist and regenerated contracts, or CI gates (`docs:check`, `openapi:check`, `api:inventory:check`, `version:sync:check`) fail.

**Files:**
- Modify: `app/docs/page.js`, `sdk/README.md`, `sdk-python/README.md`, `docs/sdk-parity.md`, `PROJECT_DETAILS.md`
- Regenerated: `docs/openapi/critical-stable.openapi.json`, `docs/api-inventory.json`, `docs/api-inventory.md`

- [ ] **Step 1: Add the new methods/routes to the docs surfaces**

Document each new SDK method (Node + Python) in `app/docs/page.js` (navItems + MethodEntry), `sdk/README.md`, and `sdk-python/README.md`. Add the four routes (`/api/x402/providers`, `/api/x402/providers/[id]`, `/api/x402/providers/[id]/endpoints`, `/api/x402/purchases`) to the route inventory prose in `PROJECT_DETAILS.md` and update `docs/sdk-parity.md` category status.

- [ ] **Step 2: Reconcile SDK method counts**

Run: `npm run sdk:count`. Verified 2026-06-04 the pre-change counts are **116 Node / 215 Python**; adding these methods raises both. The live count citations are `docs/sdk-reference.md` (~line 21, Node) and `sdk-python/README.md` (~line 25, Python) — update those. Then grep the repo for both the old and new numbers to catch any other surface that picked one up. (The route count in `PROJECT_DETAILS.md` / `docs/api-inventory.md` — 284 routes as of this push — regenerates automatically in Step 3 when the four new routes are added.)

- [ ] **Step 3: Regenerate contracts**

Run: `npm run openapi:generate` then `npm run api:inventory:generate`

- [ ] **Step 4: Verify all gates**

Run: `npm run docs:check && npm run route-sql:check && npm run openapi:check && npm run api:inventory:check && npm run version:sync:check`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/docs/page.js sdk/README.md sdk-python/README.md docs/sdk-parity.md PROJECT_DETAILS.md docs/openapi/critical-stable.openapi.json docs/api-inventory.json docs/api-inventory.md README.md docs/sdk-reference.md app/downloads/page.js
git commit -m "docs(x402): document provider + purchase surface, regenerate contracts"
```

---

### Task 14: Final verification gate

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 2: Full test suite** (not a targeted run — regressions hide in unrelated files)

Run: `npx vitest run`
Expected: all pass, including the four new x402 test files.

- [ ] **Step 3: App build** (required for any `app/**` change)

Run: `npx next build`
Expected: build succeeds.

- [ ] **Step 4: Migration applied locally**

Confirm `npm run db:migrate` was run after Task 1 and the three tables exist (else local requests 401).

- [ ] **Step 5: Commit any remaining generated artifacts and stop**

The pre-commit hook may regenerate livingcode artifacts (it triggers on `app/api/`, `app/lib/`, `schema/schema.js`, `middleware.js`, `livingcode/` changes). Let it run; stage what it produces.

```bash
git add -A
git commit -m "chore(x402): foundation complete — providers, governed purchases, SDK parity"
```

---

## Self-Review

**Spec coverage** (against `2026-06-04-x402-spend-governance-design.md`):
- §1 boundary map — honored: wallet/executor/adapters stay agent-side; this plan adds only registry/policy/record/score surfaces. ✓
- §2 correction (no in-DashClaw executor/adapters) — honored: no execution service or adapter code. ✓
- §3 data model — `x402_purchases` keyed by `action_id` (Task 1/4); policy as a `guard_policies` type, not a table (Task 5); providers/endpoints registry (Tasks 2–3, 6–8). The March-spec `x402_policies`/`x402_approvals` tables are intentionally subsumed by existing `guard_policies` + approvals (documented in Preconditions). ✓
- §4 governed loop — guard → createAction → branch on status → (existing approval) → outcome → artifact (Task 9, 12; approval/outcome reuse existing routes). ✓
- §5 surfaces — **deferred to Plan 2** (dashboard, registry UI, approval queue, detail drawer). Not in this plan by design. ✓ (gap is intentional and stated)
- §6 SDK + doc tax — Tasks 10–13. ✓
- §7 reference consumer — the research-agent wiring lives in the sibling repo; called out in Preconditions/next-step, not a DashClaw task here. **Intentional gap** — tracked for Plan 2.
- §8 sequencing — Preconditions enforce "after the concurrent session lands." ✓

**Placeholder scan:** No TBD/TODO. The two "verify the exact shape" notes (Task 6 `getSql` sync/async; Task 9 `createBlockedActionRecord` payload) are deliberate ground-truth checks against files the concurrent session may have touched, each with the fallback stated — not placeholders.

**Type consistency:** Repository fns (`createProvider/listProviders/getProvider/updateProvider`, `createEndpoint/listEndpoints/getEndpoint`, `createPurchase/getPurchase/listPurchases/setPurchaseOutcome`) are named identically across their defining task, the routes that import them, and the test mocks. SDK method names match between Node (camelCase) and Python (snake_case) one-for-one. Guard case key `x402_spend_limit` matches between Task 5 impl and test.

**Scope check:** This is one cohesive foundation (DB + repo + policy + routes + SDK + docs) that produces working, testable software: register a provider, govern+record a purchase, score its outcome, attach a result artifact. UI and analytics are correctly split into Plan 2.

---

## Plan index (follow-on plans — write after this lands)

- **Plan 2 — Operator surfaces:** spend dashboard, provider-registry page (model on `app/agents/registry/page.jsx`), approval-queue UI, x402 detail drawer, "Paid Capability" timeline card.
- **Plan 3 — Cost-to-value + ranking:** value-scoring analytics, provider ROI rollups, low-value deprioritization, exceptions view.
- **Plan 4 — Reference consumer integration (sibling repo):** wire `budget-aware-research-agent` to push its `cost-ledger.jsonl` via `recordPurchase`, route its free/paid decision through `guard`, reconcile 402-Index discovery against the DashClaw registry.

## Execution Handoff

This plan is **blocked on the Preconditions** (the concurrent reputation/registry/Group-A session must land first, and the user has asked not to edit code while it runs). Do not begin execution until that work is committed and the user gives the go-ahead.

When unblocked, two execution options:
1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks (superpowers:subagent-driven-development).
2. **Inline Execution** — batch execution with checkpoints (superpowers:executing-plans).
