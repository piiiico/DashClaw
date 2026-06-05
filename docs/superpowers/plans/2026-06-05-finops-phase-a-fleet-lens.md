# FinOps Subsystem — Phase A (Foundation + Fleet Lens) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only FinOps aggregation layer + a "Spend" section that presents **Fleet spend** as two distinct numbers — Agent Spend (LLM token cost) and x402 Purchases (capability micropayments) — fixing the current bug where x402 spend is silently summed into Agent Spend.

**Architecture:** Aggregation-not-fusion. Each table's spend rollup lives with its owning repository (`getCostAggregation` in actions.repository for Agent Spend; a new `getX402SpendAggregation` in x402.repository for purchases). A thin `finops.repository.js` *composes* them into a Fleet-lens shape behind `GET /api/finops/spend`. A new "Spend" nav group renders the overview + an x402 Purchases page. No new tables; no domain logic moved.

**Tech Stack:** Next.js 16 App Router (JS), Neon/Postgres via tagged-template `sql`, vitest (mocked `sql`/repositories), recharts for trends, the existing `PageLayout`/`Card`/`Badge` UI kit. Source spec: `docs/superpowers/specs/2026-06-05-unified-finops-spend-subsystem-design.md` (Phase A).

---

## Decisions locked by this plan (resolving spec §11 open questions, Phase A only)
- `finops.repository.js` lives at `app/lib/repositories/finops.repository.js` (matches the repository convention) and **composes** existing repository functions — it issues no novel domain SQL of its own except trivial combination.
- The "Spend" nav entry is a **dedicated nav group** (it will grow with the Claude-Code lens in Phase B/C).
- Currency: Phase A treats `x402_purchases.spend_amount` as a USD figure (1 USDC ≈ 1 USD); revisit in a later phase.
- **Pages are not unit-tested in this repo** (verified: zero `app/**/*.test.jsx`). TDD the repository + route layers; build-verify the pages with `npx next build`.

## Verified facts (against HEAD, 2026-06-05)
- `getCostAggregation(sql, orgId, { period = '30d', agentId = null })` in `app/lib/repositories/actions.repository.js:1002-1053` runs three `SUM(cost_estimate)` queries (total, by_agent, by_day) over `action_records`. Consumed by `GET /api/actions/costs` → `AgentSpendCard.js`. **The x402 break-out fix goes here.**
- `listPurchases` + `GET /api/x402/purchases` already exist (the x402 Purchases page just renders that route).
- Aggregation route pattern: `app/api/analytics/route.js` (`getSql()` sync, `getOrgId()`, repository call, `NextResponse.json`).
- Dashboard page pattern: `app/analytics/page.jsx` (`'use client'`, `useCallback`+`useEffect` fetch, `PageLayout` + recharts `AreaChart`). `PageLayout` = `app/components/PageLayout.js`; `Card` = `app/components/ui/Card.js`; recharts brand color `#f97316` is the sanctioned non-CSS hex exception.
- `getSql()` is synchronous. `@/` test alias → `app/`. Single-file test: `npx vitest run <file>`; full suite: `npx vitest run`.

## File Structure

| File | Responsibility | Create/Modify |
|---|---|---|
| `app/lib/repositories/actions.repository.js` | add `action_type <> 'x402_purchase'` to `getCostAggregation`'s 3 queries | Modify |
| `app/lib/repositories/x402.repository.js` | add `getX402SpendAggregation` | Modify |
| `app/lib/repositories/finops.repository.js` | `getFleetSpend` — composes the two | Create |
| `app/api/finops/spend/route.js` | `GET /api/finops/spend` | Create |
| `app/components/Sidebar.js` | add the "Spend" nav group | Modify |
| `app/spend/page.jsx` | Fleet-spend overview page | Create |
| `app/spend/x402/page.jsx` | x402 Purchases table page | Create |
| `__tests__/unit/finops-cost-aggregation.test.js` | Task 1 test (x402 exclusion) | Create |
| `__tests__/unit/finops-x402-aggregation.test.js` | Task 2 test | Create |
| `__tests__/unit/finops-repository.test.js` | Task 3 test (composition) | Create |
| `__tests__/unit/finops-spend.route.test.js` | Task 4 test (route) | Create |

Commands: single test `npx vitest run __tests__/unit/<file>`; full suite `npx vitest run`; lint `npm run lint`; build `npx next build`.

## Multi-agent hygiene (applies to every task)
The working tree has UNCOMMITTED other-session files (`.impeccable.md`, `DESIGN.md`, `PRODUCT.md`, `docs/rfcs/*`, `docs/superpowers/*` x402+finops docs). Commit ONLY the files each task names, by explicit pathspec. NEVER `git add -A`/`.`/`-u`. Tasks touching `app/api/`, `app/lib/`, or `app/components/` will trigger the pre-commit hook to regenerate + stage `docs/api-inventory.*` / livingcode artifacts — that is expected; after committing, run `git show --name-only HEAD | grep -iE "impeccable|DESIGN.md|PRODUCT.md|rfcs/|superpowers/"` and confirm it returns NOTHING.

---

### Task 1: Break-out fix — exclude x402 from Agent Spend

**Files:**
- Modify: `app/lib/repositories/actions.repository.js` (`getCostAggregation`, ~lines 1002-1053)
- Test: `__tests__/unit/finops-cost-aggregation.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCostAggregation } from '@/lib/repositories/actions.repository.js';

let sql;
beforeEach(() => { sql = vi.fn().mockResolvedValue([{ total_cost_usd: 0, total_tokens_in: 0, total_tokens_out: 0 }]); });

describe('getCostAggregation — Agent Spend excludes x402 purchases', () => {
  it('adds an action_type <> x402_purchase filter to all three rollup queries', async () => {
    await getCostAggregation(sql, 'org_1', { period: '30d' });
    const allSql = sql.mock.calls.map((c) => c[0].join(' ')).join(' || ');
    const matches = allSql.match(/action_type <> 'x402_purchase'/g) || [];
    expect(matches.length).toBe(3); // total + by_agent + by_day each exclude x402
  });

  it('stays org-scoped', async () => {
    await getCostAggregation(sql, 'org_1', { period: '7d' });
    const boundValues = sql.mock.calls.flatMap((c) => c.slice(1));
    expect(boundValues).toContain('org_1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/finops-cost-aggregation.test.js`
Expected: FAIL — the exclusion appears 0 times (matches.length === 0).

- [ ] **Step 3: Implement** — in `getCostAggregation`, add the literal clause `AND action_type <> 'x402_purchase'` immediately after the `AND created_at::timestamptz >= ${since}::timestamptz` line in **each** of the three queries (total, by_agent, by_day). Example for the total query:

```javascript
  const [totals] = await sql`
    SELECT
      COALESCE(SUM(cost_estimate), 0)::real as total_cost_usd,
      COALESCE(SUM(tokens_in), 0)::integer as total_tokens_in,
      COALESCE(SUM(tokens_out), 0)::integer as total_tokens_out
    FROM action_records
    WHERE org_id = ${orgId}
      AND created_at::timestamptz >= ${since}::timestamptz
      AND action_type <> 'x402_purchase'
      ${agentFilter}`;
```

Apply the same added line to the by_agent and by_day queries. Do NOT change anything else in the function. Read the current function first to match its exact structure/indentation.

> Why: `getCostAggregation` powers `AgentSpendCard` via `/api/actions/costs`. Excluding `x402_purchase` here means "Agent Spend" becomes pure LLM token cost; x402 micropayment spend is reported separately by Task 2. This is the spec's §8 break-out fix and needs no change to the card or route.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/finops-cost-aggregation.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/repositories/actions.repository.js __tests__/unit/finops-cost-aggregation.test.js
git commit -m "fix(finops): exclude x402 purchases from Agent Spend aggregation"
```

---

### Task 2: x402 spend aggregation

**Files:**
- Modify: `app/lib/repositories/x402.repository.js` (append after the Purchases section)
- Test: `__tests__/unit/finops-x402-aggregation.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getX402SpendAggregation } from '@/lib/repositories/x402.repository.js';

let sql;
beforeEach(() => { sql = vi.fn(); });

describe('getX402SpendAggregation', () => {
  it('sums spend_amount from x402_purchases, org-scoped, with by_day + by_provider', async () => {
    sql.mockResolvedValueOnce([{ total_spend_usd: 1.25, purchase_count: 3 }]); // total
    sql.mockResolvedValueOnce([{ date: '2026-06-05', spend_usd: 1.25, purchase_count: 3 }]); // by_day
    sql.mockResolvedValueOnce([{ provider_id: 'prov_x', spend_usd: 1.25, purchase_count: 3 }]); // by_provider
    const out = await getX402SpendAggregation(sql, 'org_1', { period: '30d' });
    expect(out.total_spend_usd).toBe(1.25);
    expect(out.by_day).toHaveLength(1);
    expect(out.by_provider[0].provider_id).toBe('prov_x');
    const allSql = sql.mock.calls.map((c) => c[0].join(' ')).join(' || ');
    expect(allSql).toContain('FROM x402_purchases');
    expect(allSql).toContain('SUM(spend_amount)');
    const boundValues = sql.mock.calls.flatMap((c) => c.slice(1));
    expect(boundValues).toContain('org_1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/finops-x402-aggregation.test.js`
Expected: FAIL — `getX402SpendAggregation` is not exported.

- [ ] **Step 3: Implement** — append to `app/lib/repositories/x402.repository.js`:

```javascript

// --- Aggregation (FinOps Fleet lens) ---------------------------------------

const X402_PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

export async function getX402SpendAggregation(sql, orgId, { period = '30d' } = {}) {
  const days = X402_PERIOD_DAYS[period] ?? 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [totals] = await sql`
    SELECT COALESCE(SUM(spend_amount), 0)::real AS total_spend_usd, COUNT(*)::integer AS purchase_count
    FROM x402_purchases
    WHERE org_id = ${orgId} AND created_at::timestamptz >= ${since}::timestamptz`;
  const byDay = await sql`
    SELECT DATE(created_at::timestamptz) AS date, COALESCE(SUM(spend_amount), 0)::real AS spend_usd, COUNT(*)::integer AS purchase_count
    FROM x402_purchases
    WHERE org_id = ${orgId} AND created_at::timestamptz >= ${since}::timestamptz
    GROUP BY DATE(created_at::timestamptz)
    ORDER BY date DESC`;
  const byProvider = await sql`
    SELECT provider_id, COALESCE(SUM(spend_amount), 0)::real AS spend_usd, COUNT(*)::integer AS purchase_count
    FROM x402_purchases
    WHERE org_id = ${orgId} AND created_at::timestamptz >= ${since}::timestamptz
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/finops-x402-aggregation.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/repositories/x402.repository.js __tests__/unit/finops-x402-aggregation.test.js
git commit -m "feat(finops): x402 spend aggregation (by day + provider)"
```

---

### Task 3: finops.repository — compose the Fleet lens

**Files:**
- Create: `app/lib/repositories/finops.repository.js`
- Test: `__tests__/unit/finops-repository.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ getCostAggregation: vi.fn(), getX402SpendAggregation: vi.fn() }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({ getCostAggregation: m.getCostAggregation }));
vi.mock('@/lib/repositories/x402.repository.js', () => ({ getX402SpendAggregation: m.getX402SpendAggregation }));

const { getFleetSpend } = await import('@/lib/repositories/finops.repository.js');
const sql = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  m.getCostAggregation.mockResolvedValue({ total_cost_usd: 10, by_day: [{ date: '2026-06-05', cost_usd: 10 }], by_agent: [{ agent_id: 'a1', cost_usd: 10 }] });
  m.getX402SpendAggregation.mockResolvedValue({ total_spend_usd: 2.5, by_day: [{ date: '2026-06-05', spend_usd: 2.5 }], by_provider: [{ provider_id: 'prov_x', spend_usd: 2.5 }] });
});

describe('getFleetSpend', () => {
  it('composes agent + x402 spend and sums the fleet total', async () => {
    const out = await getFleetSpend(sql, 'org_1', { period: '30d' });
    expect(m.getCostAggregation).toHaveBeenCalledWith(sql, 'org_1', { period: '30d' });
    expect(m.getX402SpendAggregation).toHaveBeenCalledWith(sql, 'org_1', { period: '30d' });
    expect(out.lens).toBe('fleet');
    expect(out.agent.total_cost_usd).toBe(10);
    expect(out.x402.total_spend_usd).toBe(2.5);
    expect(out.fleet_total_usd).toBeCloseTo(12.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/finops-repository.test.js`
Expected: FAIL — `finops.repository.js` not found.

- [ ] **Step 3: Implement**

```javascript
import { getCostAggregation } from './actions.repository.js';
import { getX402SpendAggregation } from './x402.repository.js';

/**
 * Read-only Fleet-lens rollup: Agent Spend (LLM token cost, x402 excluded) +
 * x402 Purchases (capability micropayments). Composes the owning repositories;
 * owns no tables of its own.
 */
export async function getFleetSpend(sql, orgId, { period = '30d' } = {}) {
  const [agent, x402] = await Promise.all([
    getCostAggregation(sql, orgId, { period }),
    getX402SpendAggregation(sql, orgId, { period }),
  ]);
  const fleet_total_usd = (agent?.total_cost_usd ?? 0) + (x402?.total_spend_usd ?? 0);
  return { lens: 'fleet', period, agent, x402, fleet_total_usd };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/finops-repository.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/repositories/finops.repository.js __tests__/unit/finops-repository.test.js
git commit -m "feat(finops): Fleet-lens composition repository"
```

---

### Task 4: Route — GET /api/finops/spend

**Files:**
- Create: `app/api/finops/spend/route.js`
- Test: `__tests__/unit/finops-spend.route.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSql, mockGetFleetSpend } = vi.hoisted(() => ({ mockSql: vi.fn(), mockGetFleetSpend: vi.fn() }));
vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1' }));
vi.mock('@/lib/repositories/finops.repository.js', () => ({ getFleetSpend: mockGetFleetSpend }));

const { GET } = await import('@/api/finops/spend/route.js');
beforeEach(() => vi.clearAllMocks());

describe('GET /api/finops/spend', () => {
  it('returns the fleet rollup and passes the period through', async () => {
    mockGetFleetSpend.mockResolvedValue({ lens: 'fleet', fleet_total_usd: 12.5 });
    const res = await GET(new Request('http://localhost/api/finops/spend?period=7d'));
    expect(res.status).toBe(200);
    expect((await res.json()).fleet_total_usd).toBe(12.5);
    expect(mockGetFleetSpend).toHaveBeenCalledWith(mockSql, 'org_1', { period: '7d' });
  });

  it('defaults the period to 30d', async () => {
    mockGetFleetSpend.mockResolvedValue({ lens: 'fleet', fleet_total_usd: 0 });
    await GET(new Request('http://localhost/api/finops/spend'));
    expect(mockGetFleetSpend).toHaveBeenCalledWith(mockSql, 'org_1', { period: '30d' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/finops-spend.route.test.js`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement** — create `app/api/finops/spend/route.js`:

```javascript
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { getFleetSpend } from '../../../lib/repositories/finops.repository.js';

const ALLOWED_PERIODS = new Set(['7d', '30d', '90d']);

/** GET /api/finops/spend — Fleet-lens spend rollup (Agent Spend + x402). */
export async function GET(request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const raw = new URL(request.url).searchParams.get('period') || '30d';
    const period = ALLOWED_PERIODS.has(raw) ? raw : '30d';
    const data = await getFleetSpend(sql, orgId, { period });
    return NextResponse.json(data);
  } catch (err) {
    console.error('[FINOPS/SPEND] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

> Import depth from `app/api/finops/spend/route.js` to `app/lib` is `../../../lib/...` (spend → finops → api → app). `getSql()` is sync.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/finops-spend.route.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** (pre-commit hook will also stage regenerated api-inventory/livingcode — expected)

```bash
git add app/api/finops/spend/route.js __tests__/unit/finops-spend.route.test.js
git commit -m "feat(finops): GET /api/finops/spend route"
```
Then verify hygiene: `git show --name-only HEAD | grep -iE "impeccable|DESIGN.md|PRODUCT.md|rfcs/|superpowers/"` → must be empty.

---

### Task 5: Sidebar — the "Spend" nav group

**Files:**
- Modify: `app/components/Sidebar.js`

- [ ] **Step 1: Add the imports** — in the lucide-react import block, add `DollarSign` and `ShoppingCart` to the existing named imports (do not duplicate any already present).

- [ ] **Step 2: Add the group** — insert a new group object into the `navGroups` array, immediately AFTER the `Govern` group and before `Observe`:

```javascript
  {
    label: 'Spend',
    items: [
      { href: '/spend', icon: DollarSign, label: 'Overview' },
      { href: '/spend/x402', icon: ShoppingCart, label: 'Purchases' },
    ],
  },
```

- [ ] **Step 3: Verify build** — Run: `npx next build`. Expected: compiles; no missing-icon/import error. (The `/spend` routes are added in Tasks 6–7; the nav links will 404 until then, which is fine for this step.)

- [ ] **Step 4: Commit**

```bash
git add app/components/Sidebar.js
git commit -m "feat(finops): add Spend nav group"
```

---

### Task 6: Spend overview page (Fleet lens)

**Files:**
- Create: `app/spend/page.jsx`

(Pages are not unit-tested in this repo; build-verify only.)

- [ ] **Step 1: Implement** — create `app/spend/page.jsx`:

```jsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import PageLayout from '../components/PageLayout';

const PERIODS = ['7d', '30d', '90d'];
const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;

export default function SpendOverviewPage() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/finops/spend?period=${period}`);
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error('Failed to load fleet spend:', err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  // Merge agent + x402 by_day into one trend series keyed by date.
  const trend = (() => {
    if (!data) return [];
    const byDate = {};
    for (const d of data.agent?.by_day || []) byDate[d.date] = { date: d.date, agent: Number(d.cost_usd || 0), x402: 0 };
    for (const d of data.x402?.by_day || []) (byDate[d.date] ||= { date: d.date, agent: 0, x402: 0 }).x402 = Number(d.spend_usd || 0);
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ ...r, total: r.agent + r.x402 }));
  })();

  return (
    <PageLayout
      title="Spend"
      subtitle="Fleet spend — agent LLM cost and x402 capability purchases"
      breadcrumbs={['Spend', 'Overview']}
      maturity="beta"
      actions={
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2 py-1 text-xs rounded-md border transition-colors ${period === p ? 'border-brand/40 bg-brand/10 text-brand' : 'border-border text-secondary hover:border-border-hover'}`}
            >
              {p}
            </button>
          ))}
        </div>
      }
    >
      {loading && !data ? (
        <div className="text-sm text-tertiary">Loading…</div>
      ) : data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-2">Fleet spend ({period})</div>
              <div className="text-2xl font-semibold tabular-nums">{fmt(data.fleet_total_usd)}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-2">Agent Spend (LLM)</div>
              <div className="text-2xl font-semibold tabular-nums">{fmt(data.agent?.total_cost_usd)}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-2">x402 Purchases</div>
              <div className="text-2xl font-semibold tabular-nums">{fmt(data.x402?.total_spend_usd)}</div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface-secondary p-5">
            <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-4">Daily fleet spend</div>
            {trend.length === 0 ? (
              <div className="text-sm text-tertiary py-8 text-center">No spend in this period.</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trend} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <defs>
                    <linearGradient id="fleetSpendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f97316" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fill: '#808088', fontSize: 10 }} tickFormatter={(v) => String(v).slice(5)} />
                  <YAxis tick={{ fill: '#808088', fontSize: 10 }} tickFormatter={(v) => `$${v}`} width={45} />
                  <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background: '#1a1a1a', border: '1px solid #ffffff1f', borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="total" stroke="#f97316" fill="url(#fleetSpendGradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      ) : (
        <div className="text-sm text-error">Failed to load spend.</div>
      )}
    </PageLayout>
  );
}
```

> Note: recharts requires literal hex for `stroke`/`fill`/tick colors — the brand `#f97316` and token-equivalent hex here are the sanctioned non-CSS exception (mirrors `app/analytics/components/CostTrendChart.jsx`). Confirm `PageLayout` accepts the `title/subtitle/breadcrumbs/maturity/actions` props by reading `app/components/PageLayout.js`; adapt prop names if they differ.

- [ ] **Step 2: Build-verify**

Run: `npx next build`
Expected: compiles; `/spend` appears in the route table.

- [ ] **Step 3: Commit**

```bash
git add app/spend/page.jsx
git commit -m "feat(finops): Spend overview page (Fleet lens)"
```

---

### Task 7: x402 Purchases page

**Files:**
- Create: `app/spend/x402/page.jsx`

- [ ] **Step 1: Implement** — create `app/spend/x402/page.jsx` (renders the existing `GET /api/x402/purchases`):

```jsx
'use client';

import { useState, useEffect } from 'react';
import PageLayout from '../../components/PageLayout';

const fmt = (n, cur) => `${Number(n || 0).toFixed(4)} ${cur || 'USDC'}`;
const STATUS_TONE = {
  succeeded: 'text-success', approved: 'text-secondary', pending: 'text-warning', failed: 'text-error', blocked: 'text-error',
};

export default function X402PurchasesPage() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/x402/purchases');
        if (res.ok) setRows((await res.json()).purchases || []);
      } catch (err) {
        console.error('Failed to load x402 purchases:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <PageLayout title="x402 Purchases" subtitle="Governed capability purchases" breadcrumbs={['Spend', 'Purchases']} maturity="beta">
      {loading ? (
        <div className="text-sm text-tertiary">Loading…</div>
      ) : !rows || rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-secondary p-8 text-center text-sm text-tertiary">
          No governed purchases yet.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface-secondary overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-tertiary border-b border-border">
                <th className="text-left font-medium px-4 py-3">Provider</th>
                <th className="text-left font-medium px-4 py-3">Agent</th>
                <th className="text-right font-medium px-4 py-3">Spend</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-left font-medium px-4 py-3">Reason</th>
                <th className="text-left font-medium px-4 py-3">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.action_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{r.provider_id || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.agent_id || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmt(r.spend_amount, r.currency)}</td>
                  <td className={`px-4 py-3 ${STATUS_TONE[r.execution_status] || 'text-secondary'}`}>{r.execution_status || '—'}</td>
                  <td className="px-4 py-3 text-secondary max-w-xs truncate" title={r.purchase_reason || ''}>{r.purchase_reason || '—'}</td>
                  <td className="px-4 py-3 text-tertiary tabular-nums">{r.created_at ? String(r.created_at).slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageLayout>
  );
}
```

- [ ] **Step 2: Build-verify**

Run: `npx next build`
Expected: compiles; `/spend/x402` appears in the route table.

- [ ] **Step 3: Commit**

```bash
git add app/spend/x402/page.jsx
git commit -m "feat(finops): x402 Purchases page"
```

---

### Task 8: Final verification gate

- [ ] **Step 1: Lint** — Run: `npm run lint`. Expected: no errors.

- [ ] **Step 2: Full test suite** (not targeted) — Run: `npx vitest run`. Expected: all pass, including the four new finops test files. Watch that the Task-1 change didn't break existing `getCostAggregation`/AgentSpendCard tests (if any exist, they should still pass — the exclusion only removes x402 rows).

- [ ] **Step 3: App build** — Run: `npx next build`. Expected: build succeeds; `/spend`, `/spend/x402`, and `/api/finops/spend` all appear in the route table.

- [ ] **Step 4: Manual smoke (optional, ask the operator to run the dev server)** — `npm run dev`, visit `/spend`: Fleet spend should equal Agent Spend + x402 Purchases, and the Agent Spend number should now EXCLUDE x402 (the acceptance signal for the break-out fix).

- [ ] **Step 5: Commit any remaining hook-generated artifacts** (by explicit pathspec — never `git add -A`). If `git status` shows only generated artifacts (`docs/api-inventory.*`, livingcode), stage those explicitly and commit; otherwise nothing to do.

---

## Self-Review

**Spec coverage** (against `2026-06-05-unified-finops-spend-subsystem-design.md`, Phase A):
- §3 SpendContribution abstraction → represented implicitly by the Fleet-lens shape (`agent`/`x402`/`fleet_total_usd`); the full normalized `SpendContribution[]` type is only needed when the Claude-Code lens lands (Phase B) — Phase A's two-source composition doesn't require the generic type yet (YAGNI). ✓ (intentional minimal form)
- §4 aggregation layer (read-only, composes existing repos, org-scoped, no tables) → Tasks 2–4. ✓
- §5 "Spend" section + overview + Fleet lens → Tasks 5–7. ✓
- §8 x402 break-out fix → Task 1. ✓
- §9 Phase A scope (subsumes "x402 Plan 2") → the x402 Purchases page (Task 7) is the x402 dashboard. ✓
- §6 boundary/tiering → no governance moved; pages are read-only views. ✓
- Phase B/C (Code Sessions lens, CostClaw, pricing reconciliation) → correctly OUT of this plan.

**Placeholder scan:** No TBD/TODO. The two "read the current function/component to match structure" notes (Task 1 indentation, Task 6 PageLayout props) are deliberate ground-truth checks with fallbacks, not placeholders.

**Type consistency:** `getFleetSpend` returns `{ lens, period, agent, x402, fleet_total_usd }`; the route returns it verbatim; the overview page reads `data.fleet_total_usd`, `data.agent.total_cost_usd`, `data.x402.total_spend_usd`, `data.agent.by_day[].cost_usd`, `data.x402.by_day[].spend_usd` — all matching the shapes returned by `getCostAggregation` (`total_cost_usd`, `by_day[].cost_usd`) and `getX402SpendAggregation` (`total_spend_usd`, `by_day[].spend_usd`) as defined in Tasks 1–2. Consistent.

---

## Execution Handoff

Plan complete. Two execution options:
1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks.
2. **Inline Execution** — batch execution with checkpoints.

(Phases B and C get their own plans later — B with RFC Tier 1; C after the RFC 0002 §8 billing-gate decision.)
