# FinOps Phase B — Claude-Code Spend Lens + Rate-Card Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Your Claude Code" advisory spend lens to the FinOps `/spend` section (re-homing Code Sessions cost) and lock a rate-card parity test, without touching money, schema, or domain logic.

**Architecture:** Clone the shipped Phase-A Fleet-lens pattern. A new by-day/by-project aggregation in `code-sessions.repository.js` (reads stored `code_sessions.cost_usd`) → composed by a new `getClaudeCodeSpend` in `finops.repository.js` (owns no tables) → served by a `?lens=` branch on the existing `GET /api/finops/spend` → rendered on a new `/spend/code` page. A separate parity test locks `billing.js` ↔ `claude-code/pricing.js` agreement so the two cards can't drift.

**Tech Stack:** Next.js 16 (App Router, JS — no TS), Neon/Postgres via tagged-template `sql`, vitest (mocked `sql`/repositories), recharts, lucide-react, CSS design tokens from `app/globals.css`.

**Ground-truth invariants (verified 2026-06-05, do not re-litigate):**
- `getSql()` is **sync** (no `await`). Repository functions take `(sql, orgId, …)`.
- Repository SQL tests use a **plain `vi.fn()`** as `sql` (NOT `createSqlMock`) and assert **bound values** (`call.slice(1)` / `call.toContain(...)`), not just the SQL skeleton.
- `code_sessions` has columns `org_id`, `project_id`, `cost_usd`, `cache_savings_usd`, `created_at`; `code_projects` has `id`, `slug`. The sibling `aggregateCodeSignalsByKind` filters `WHERE s.org_id = ${orgId} AND s.created_at >= ${sinceIso}` (no cast) — mirror that.
- **No direct SQL in routes** (`route-sql:check`); SQL lives in repositories.
- Pages are **build-verified**, not unit-tested (house pattern).
- **Never hardcode hex** — use CSS tokens. `Date.now()` is fine in app/test code (only Workflow scripts forbid it).

---

### Task 1: `getCodeSessionSpendAggregation` (code-sessions repository)

**Files:**
- Modify: `app/lib/repositories/code-sessions.repository.js` (append a new exported function near the other aggregators, e.g. after `aggregateCodeSignalsByKind`)
- Test: `__tests__/unit/code-session-spend-aggregation.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/code-session-spend-aggregation.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCodeSessionSpendAggregation } = await import('@/lib/repositories/code-sessions.repository.js');

let sql;
beforeEach(() => {
  // Three sequential sql calls: totals, by_day, by_project.
  sql = vi.fn()
    .mockResolvedValueOnce([{ total_cost_usd: 12.5, total_cache_savings_usd: 3.2, session_count: 4 }])
    .mockResolvedValueOnce([{ date: '2026-06-05', cost_usd: 12.5, session_count: 4 }])
    .mockResolvedValueOnce([{ project_id: 'cp_1', project_name: 'demo', cost_usd: 12.5, session_count: 4 }]);
});

describe('getCodeSessionSpendAggregation', () => {
  it('scopes every query to the org and the requested window, and returns totals + by_day + by_project', async () => {
    const out = await getCodeSessionSpendAggregation(sql, 'org_1', { period: '7d' });

    // org scoping is bound into every one of the three queries
    expect(sql.mock.calls).toHaveLength(3);
    for (const call of sql.mock.calls) expect(call).toContain('org_1');

    // the window bound is ~7 days back (period → days mapping)
    const sinceIso = sql.mock.calls[0].find((v) => typeof v === 'string' && v.includes('T'));
    const days = (Date.now() - new Date(sinceIso).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    // shape
    expect(out.period).toBe('7d');
    expect(out.total_cost_usd).toBe(12.5);
    expect(out.total_cache_savings_usd).toBe(3.2);
    expect(out.session_count).toBe(4);
    expect(out.by_day[0]).toMatchObject({ date: '2026-06-05', cost_usd: 12.5 });
    expect(out.by_project[0]).toMatchObject({ project_id: 'cp_1', project_name: 'demo' });
  });

  it('defaults an unknown period to a 30-day window', async () => {
    await getCodeSessionSpendAggregation(sql, 'org_1', { period: 'bogus' });
    const sinceIso = sql.mock.calls[0].find((v) => typeof v === 'string' && v.includes('T'));
    const days = (Date.now() - new Date(sinceIso).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/code-session-spend-aggregation.test.js`
Expected: FAIL — `getCodeSessionSpendAggregation is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `app/lib/repositories/code-sessions.repository.js` (after `aggregateCodeSignalsByKind`):

```js
// ---------------------------------------------------------------------------
// FinOps Claude-Code lens — read-only spend rollup over stored cost_usd.
// Both Agent Spend and this cost already run through billing.js at ingest,
// so this is a pure aggregation of stored values (no re-pricing).
// ---------------------------------------------------------------------------

const CODE_SPEND_PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

export async function getCodeSessionSpendAggregation(sql, orgId, { period = '30d' } = {}) {
  const days = CODE_SPEND_PERIOD_DAYS[period] ?? 30;
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();

  const [totals] = await sql`
    SELECT COALESCE(SUM(cost_usd), 0)::real AS total_cost_usd,
           COALESCE(SUM(cache_savings_usd), 0)::real AS total_cache_savings_usd,
           COUNT(*)::integer AS session_count
    FROM code_sessions
    WHERE org_id = ${orgId} AND created_at >= ${sinceIso}`;

  const byDay = await sql`
    SELECT DATE(created_at) AS date,
           COALESCE(SUM(cost_usd), 0)::real AS cost_usd,
           COUNT(*)::integer AS session_count
    FROM code_sessions
    WHERE org_id = ${orgId} AND created_at >= ${sinceIso}
    GROUP BY DATE(created_at)
    ORDER BY date DESC`;

  const byProject = await sql`
    SELECT p.id AS project_id, p.slug AS project_name,
           COALESCE(SUM(s.cost_usd), 0)::real AS cost_usd,
           COUNT(*)::integer AS session_count
    FROM code_sessions s
    JOIN code_projects p ON p.id = s.project_id
    WHERE s.org_id = ${orgId} AND s.created_at >= ${sinceIso}
    GROUP BY p.id, p.slug
    ORDER BY cost_usd DESC`;

  return {
    period,
    total_cost_usd: totals?.total_cost_usd ?? 0,
    total_cache_savings_usd: totals?.total_cache_savings_usd ?? 0,
    session_count: totals?.session_count ?? 0,
    by_day: byDay,
    by_project: byProject,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/code-session-spend-aggregation.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/repositories/code-sessions.repository.js __tests__/unit/code-session-spend-aggregation.test.js
git commit -m "feat(finops): code-session spend aggregation (by-day/by-project) for the Claude-Code lens"
```

---

### Task 2: `getClaudeCodeSpend` (FinOps repository)

**Files:**
- Modify: `app/lib/repositories/finops.repository.js` (add import + new export)
- Test: `__tests__/unit/finops-repository.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Edit `__tests__/unit/finops-repository.test.js`. Extend the hoisted mocks and add the code-sessions mock + a new describe. The full updated file:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getCostAggregation: vi.fn(),
  getX402SpendAggregation: vi.fn(),
  getCodeSessionSpendAggregation: vi.fn(),
}));
vi.mock('@/lib/repositories/actions.repository.js', () => ({ getCostAggregation: m.getCostAggregation }));
vi.mock('@/lib/repositories/x402.repository.js', () => ({ getX402SpendAggregation: m.getX402SpendAggregation }));
vi.mock('@/lib/repositories/code-sessions.repository.js', () => ({ getCodeSessionSpendAggregation: m.getCodeSessionSpendAggregation }));

const { getFleetSpend, getClaudeCodeSpend } = await import('@/lib/repositories/finops.repository.js');
const sql = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  m.getCostAggregation.mockResolvedValue({ total_cost_usd: 10, by_day: [{ date: '2026-06-05', cost_usd: 10 }], by_agent: [{ agent_id: 'a1', cost_usd: 10 }] });
  m.getX402SpendAggregation.mockResolvedValue({ total_spend_usd: 2.5, by_day: [{ date: '2026-06-05', spend_usd: 2.5 }], by_provider: [{ provider_id: 'prov_x', spend_usd: 2.5 }] });
  m.getCodeSessionSpendAggregation.mockResolvedValue({ total_cost_usd: 8.25, total_cache_savings_usd: 1.1, session_count: 3, by_day: [{ date: '2026-06-05', cost_usd: 8.25 }], by_project: [{ project_id: 'cp_1', project_name: 'demo', cost_usd: 8.25 }] });
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

describe('getClaudeCodeSpend', () => {
  it('composes code-session spend under the claude_code lens', async () => {
    const out = await getClaudeCodeSpend(sql, 'org_1', { period: '30d' });
    expect(m.getCodeSessionSpendAggregation).toHaveBeenCalledWith(sql, 'org_1', { period: '30d' });
    expect(out.lens).toBe('claude_code');
    expect(out.period).toBe('30d');
    expect(out.code_sessions.total_cost_usd).toBe(8.25);
    expect(out.code_total_usd).toBeCloseTo(8.25);
  });

  it('defaults the total to 0 when the source returns nothing', async () => {
    m.getCodeSessionSpendAggregation.mockResolvedValue(undefined);
    const out = await getClaudeCodeSpend(sql, 'org_1', { period: '7d' });
    expect(out.code_total_usd).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/finops-repository.test.js`
Expected: FAIL — `getClaudeCodeSpend` is undefined (and the new code-sessions mock import resolves, since Task 1 added the function).

- [ ] **Step 3: Write minimal implementation**

Edit `app/lib/repositories/finops.repository.js`. Add the import and the new function (keep `getFleetSpend` unchanged):

```js
import { getCostAggregation } from './actions.repository.js';
import { getX402SpendAggregation } from './x402.repository.js';
import { getCodeSessionSpendAggregation } from './code-sessions.repository.js';
```

Append after `getFleetSpend`:

```js
/**
 * Read-only Claude-Code-lens rollup: the operator's own Claude Code token
 * cost (advisory — `governed: false`). Composes the code-sessions repository;
 * owns no tables of its own. Cost is already billed via billing.js at ingest,
 * so this is a pure aggregation of stored `code_sessions.cost_usd`.
 */
export async function getClaudeCodeSpend(sql, orgId, { period = '30d' } = {}) {
  const code_sessions = await getCodeSessionSpendAggregation(sql, orgId, { period });
  const code_total_usd = code_sessions?.total_cost_usd ?? 0;
  return { lens: 'claude_code', period, code_sessions, code_total_usd };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/finops-repository.test.js`
Expected: PASS (4 tests: 1 fleet + 2 claude_code, plus the existing fleet).

- [ ] **Step 5: Commit**

```bash
git add app/lib/repositories/finops.repository.js __tests__/unit/finops-repository.test.js
git commit -m "feat(finops): getClaudeCodeSpend composes the Claude-Code lens (owns no tables)"
```

---

### Task 3: `?lens=` branch on `GET /api/finops/spend`

**Files:**
- Modify: `app/api/finops/spend/route.js`
- Test: `__tests__/unit/finops-spend.route.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Replace `__tests__/unit/finops-spend.route.test.js` with:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSql, mockGetFleetSpend, mockGetClaudeCodeSpend } = vi.hoisted(() => ({
  mockSql: vi.fn(),
  mockGetFleetSpend: vi.fn(),
  mockGetClaudeCodeSpend: vi.fn(),
}));
vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1' }));
vi.mock('@/lib/repositories/finops.repository.js', () => ({
  getFleetSpend: mockGetFleetSpend,
  getClaudeCodeSpend: mockGetClaudeCodeSpend,
}));

const { GET } = await import('@/api/finops/spend/route.js');
beforeEach(() => {
  vi.clearAllMocks();
  mockGetFleetSpend.mockResolvedValue({ lens: 'fleet', fleet_total_usd: 12.5 });
  mockGetClaudeCodeSpend.mockResolvedValue({ lens: 'claude_code', code_total_usd: 8.25 });
});

describe('GET /api/finops/spend', () => {
  it('defaults to the fleet lens and passes the period through', async () => {
    const res = await GET(new Request('http://localhost/api/finops/spend?period=7d'));
    expect(res.status).toBe(200);
    expect((await res.json()).fleet_total_usd).toBe(12.5);
    expect(mockGetFleetSpend).toHaveBeenCalledWith(mockSql, 'org_1', { period: '7d' });
    expect(mockGetClaudeCodeSpend).not.toHaveBeenCalled();
  });

  it('dispatches to the Claude-Code lens on ?lens=claude-code', async () => {
    const res = await GET(new Request('http://localhost/api/finops/spend?lens=claude-code&period=90d'));
    expect((await res.json()).code_total_usd).toBe(8.25);
    expect(mockGetClaudeCodeSpend).toHaveBeenCalledWith(mockSql, 'org_1', { period: '90d' });
    expect(mockGetFleetSpend).not.toHaveBeenCalled();
  });

  it('falls back to the fleet lens on an unknown lens, and 30d on an unknown period', async () => {
    await GET(new Request('http://localhost/api/finops/spend?lens=bogus&period=bogus'));
    expect(mockGetFleetSpend).toHaveBeenCalledWith(mockSql, 'org_1', { period: '30d' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/finops-spend.route.test.js`
Expected: FAIL — the route does not yet read `?lens` or import `getClaudeCodeSpend`.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `app/api/finops/spend/route.js`:

```js
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { getFleetSpend, getClaudeCodeSpend } from '../../../lib/repositories/finops.repository.js';

const ALLOWED_PERIODS = new Set(['7d', '30d', '90d']);
const ALLOWED_LENSES = new Set(['fleet', 'claude-code']);

/** GET /api/finops/spend — spend rollup. ?lens=fleet (default) or claude-code. */
export async function GET(request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const params = new URL(request.url).searchParams;
    const rawPeriod = params.get('period') || '30d';
    const period = ALLOWED_PERIODS.has(rawPeriod) ? rawPeriod : '30d';
    const rawLens = params.get('lens') || 'fleet';
    const lens = ALLOWED_LENSES.has(rawLens) ? rawLens : 'fleet';

    const data = lens === 'claude-code'
      ? await getClaudeCodeSpend(sql, orgId, { period })
      : await getFleetSpend(sql, orgId, { period });

    return NextResponse.json(data);
  } catch (err) {
    console.error('[FINOPS/SPEND] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/finops-spend.route.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/finops/spend/route.js __tests__/unit/finops-spend.route.test.js
git commit -m "feat(finops): ?lens=claude-code branch on GET /api/finops/spend"
```

---

### Task 4: Rate-card parity test (Part 2 — drift lock)

**Files:**
- Test: `__tests__/unit/rate-card-parity.test.js` (create)

This test should **PASS immediately** — it proves the two cards already agree and then guards against future drift. If it fails, that is a real reconciliation bug to surface (do not weaken the test to make it pass).

- [ ] **Step 1: Write the test**

Create `__tests__/unit/rate-card-parity.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { estimateCost } from '@/lib/billing.js';
import { PRICES_PER_MTOK, priceFor } from '@/lib/claude-code/pricing.js';

// billing.js is canonical for STORED cost (both action_records.cost_estimate and
// code_sessions.cost_usd run through estimateCost). claude-code/pricing.js is
// analytics-only (rules engine + per-message breakdown). They share one
// LiteLLM-generated price block; this test fails the build if they drift.

// Probe billing.js's effective 4-column rate via its real matching logic:
// 1M tokens on one axis → that axis's USD/MTok rate.
function billingRate(model) {
  const M = 1_000_000;
  return {
    input: estimateCost(M, 0, model),
    output: estimateCost(0, M, model),
    cache_write: estimateCost(0, 0, model, null, { cache_creation_tokens: M, cache_read_tokens: 0 }),
    cache_read: estimateCost(0, 0, model, null, { cache_creation_tokens: 0, cache_read_tokens: M }),
  };
}

describe('rate-card parity: billing.js ↔ claude-code/pricing.js', () => {
  const claudeKeys = Object.keys(PRICES_PER_MTOK);

  it('covers at least the current frontier Claude models', () => {
    expect(claudeKeys.length).toBeGreaterThanOrEqual(8);
  });

  it.each(claudeKeys)('agrees on all 4 columns for %s', (model) => {
    const p = priceFor(model);
    const b = billingRate(model);
    expect(b.input).toBeCloseTo(p.input, 6);
    expect(b.output).toBeCloseTo(p.output, 6);
    expect(b.cache_write).toBeCloseTo(p.cache_write, 6);
    expect(b.cache_read).toBeCloseTo(p.cache_read, 6);
  });

  // Reverse guard: a frontier model must be priced (non-zero) by billing.js too,
  // so an alias added only to one card can't silently fall back.
  it.each(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'])(
    'billing.js prices %s (no $0 / Sonnet-fallback drift)',
    (model) => {
      expect(PRICES_PER_MTOK[model]).toBeDefined();
      expect(estimateCost(1_000_000, 0, model)).toBeGreaterThan(0);
    },
  );
});
```

- [ ] **Step 2: Run the test to verify it passes (proving the invariant holds today)**

Run: `npx vitest run __tests__/unit/rate-card-parity.test.js`
Expected: PASS. If any case FAILS, the two cards have genuinely drifted — STOP and report the specific model + the two values; do not edit the test to pass.

- [ ] **Step 3: Commit**

```bash
git add __tests__/unit/rate-card-parity.test.js
git commit -m "test(finops): lock billing.js <-> pricing.js rate-card parity (drift guard)"
```

---

### Task 5: `/spend/code` page + nav + sidebar guard

**Files:**
- Create: `app/spend/code/page.jsx`
- Modify: `app/components/Sidebar.js` (add nav item + fix the `/spend` active-state guard)

Pages are build-verified (not unit-tested). **Read `.impeccable.md` first** (canonical design context); use CSS tokens, never hardcoded hex.

- [ ] **Step 1: Read the design context**

Read `.impeccable.md` at the repo root. Apply its principles (evidence over decoration; orange as signal not noise; token-first; developer-reader first; WCAG AA).

**recharts color caveat (verified):** recharts renders `stroke`/`fill`/`stopColor` as SVG *presentation attributes*, where CSS `var()` is **not** reliably honored (no repo chart uses it — they all hardcode hex). Passing `var(--color-brand)` risks a build-green-but-black chart. So this page resolves the tokens to concrete values at runtime via `getComputedStyle(document.documentElement)` — keeping the palette token-driven (not a hardcoded palette) while guaranteeing it paints. The token values used as the pre-hydration fallback are `--color-brand` (#f97316), `--color-text-tertiary` (#808088), `--color-bg-tertiary` (#1a1a1a), `--color-border-hover` (rgba(255,255,255,0.12)). Do **not** copy the raw hardcoded hex from `app/spend/page.jsx` into recharts props directly.

- [ ] **Step 2: Create the page**

Create `app/spend/code/page.jsx`:

```jsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import PageLayout from '../../components/PageLayout';

const PERIODS = ['7d', '30d', '90d'];
const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;

// recharts renders stroke/fill/stop-color as SVG presentation attributes, where
// CSS var() is not reliably honored. Resolve the design tokens to concrete
// values at runtime so the chart stays token-driven (no hardcoded palette) and
// still paints. These initials mirror app/globals.css purely as a
// pre-hydration / getComputedStyle-failure fallback.
const FALLBACK_COLORS = { brand: '#f97316', tick: '#808088', tooltipBg: '#1a1a1a', tooltipBorder: 'rgba(255, 255, 255, 0.12)' };

export default function ClaudeCodeSpendPage() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [colors, setColors] = useState(FALLBACK_COLORS);

  useEffect(() => {
    const s = getComputedStyle(document.documentElement);
    const read = (name, fallback) => s.getPropertyValue(name).trim() || fallback;
    setColors({
      brand: read('--color-brand', FALLBACK_COLORS.brand),
      tick: read('--color-text-tertiary', FALLBACK_COLORS.tick),
      tooltipBg: read('--color-bg-tertiary', FALLBACK_COLORS.tooltipBg),
      tooltipBorder: read('--color-border-hover', FALLBACK_COLORS.tooltipBorder),
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/finops/spend?lens=claude-code&period=${period}`);
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error('Failed to load Claude Code spend:', err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const cs = data?.code_sessions;
  const trend = (() => {
    if (!cs?.by_day) return [];
    return [...cs.by_day]
      .map((d) => ({ date: d.date, cost: Number(d.cost_usd || 0) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  })();

  return (
    <PageLayout
      title="Your Claude Code"
      subtitle="Advisory — your own Claude Code token spend (your machine, not fleet governance)"
      breadcrumbs={['Spend', 'Your Claude Code']}
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
          <div className="rounded-lg border border-border bg-surface-secondary px-4 py-2.5 text-xs text-tertiary">
            Advisory lens — your personal Claude Code cost, aggregated from ingested sessions. Distinct from governed fleet spend.{' '}
            <Link href="/code-sessions" className="text-secondary transition-colors hover:text-brand">View sessions →</Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-2">Your Claude Code spend ({period})</div>
              <div className="text-2xl font-semibold tabular-nums">{fmt(data.code_total_usd)}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-2">Cache savings</div>
              <div className="text-2xl font-semibold tabular-nums">{fmt(cs?.total_cache_savings_usd)}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-2">Sessions</div>
              <div className="text-2xl font-semibold tabular-nums">{Number(cs?.session_count || 0)}</div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface-secondary p-5">
            <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-4">Daily Claude Code spend</div>
            {trend.length === 0 ? (
              <div className="text-sm text-tertiary py-8 text-center">No Claude Code spend in this period.</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trend} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <defs>
                    <linearGradient id="codeSpendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={colors.brand} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={colors.brand} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fill: colors.tick, fontSize: 10 }} tickFormatter={(v) => String(v).slice(5)} />
                  <YAxis tick={{ fill: colors.tick, fontSize: 10 }} tickFormatter={(v) => `$${v}`} width={45} />
                  <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="cost" stroke={colors.brand} fill="url(#codeSpendGradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {cs?.by_project?.length > 0 && (
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-3">By project</div>
              <div className="space-y-1.5">
                {cs.by_project.map((p) => (
                  <div key={p.project_id} className="flex items-center justify-between text-sm">
                    <span className="text-secondary truncate">{p.project_name}</span>
                    <span className="tabular-nums text-tertiary">{fmt(p.cost_usd)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-error">Failed to load Claude Code spend.</div>
      )}
    </PageLayout>
  );
}
```

- [ ] **Step 3: Add the nav item and fix the `/spend` active-state guard**

In `app/components/Sidebar.js`:

(a) Add a third item to the `Spend` group (`Terminal` is already imported):

```js
  {
    label: 'Spend',
    items: [
      { href: '/spend', icon: DollarSign, label: 'Overview' },
      { href: '/spend/x402', icon: ShoppingCart, label: 'Purchases' },
      { href: '/spend/code', icon: Terminal, label: 'Your Claude Code' },
    ],
  },
```

(b) Fix the pre-existing over-match: the `/spend` Overview item currently lights for every `/spend/*` route. In `isActive`, add an exact-match guard for `/spend` (mirrors the existing `/agents` special-case) just before the final `return`:

```js
    // Spend overview must not also light up for sibling /spend/* routes.
    if (href === '/spend') return pathname === '/spend';
    return pathname.startsWith(href);
```

- [ ] **Step 4: Build-verify**

Run: `npx next build`
Expected: compiles with no errors; `/spend/code` appears in the route list. (Chart colors resolve to concrete token values at runtime via `getComputedStyle`, so there is no `var()`-in-SVG silent-black risk — the build check is sufficient. Visual check is the operator's; do not start the dev server.)

- [ ] **Step 5: Commit**

```bash
git add app/spend/code/page.jsx app/components/Sidebar.js
git commit -m "feat(finops): /spend/code Claude-Code lens page + nav (token-based chart, advisory labeled)"
```

---

### Task 6: Full verification gate + push

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 2: Route SQL guardrail**

Run: `npm run route-sql:check`
Expected: PASS — no increase in per-file direct SQL (the route delegates to the repository).

- [ ] **Step 3: Full test suite** (targeted runs miss cross-file regressions)

Run: `npx vitest run`
Expected: all pass (prior baseline 2777 + the new Phase-B tests; 0 failures).

- [ ] **Step 4: Production build**

Run: `npx next build`
Expected: success; `/spend/code` route present.

- [ ] **Step 5: Push** (only after Steps 1-4 are green and READ)

Stage by explicit pathspec only — never `git add -A` (other-session files are uncommitted). All Phase-B files were committed per-task; this just pushes:

```bash
git push origin main
```

If the pre-commit hook regenerated `docs/api-inventory.*` / openapi / livingcode during any commit, those staged artifact changes are expected — let them ride.

---

## Self-Review

**Spec coverage:** Phase B spec §3 (Claude-Code lens: repo agg → finops compose → `?lens` route → `/spend/code` page → nav + guard → tests) = Tasks 1-3, 5. Spec §4 (parity test) = Task 4. Spec §5 boundary (read-only, no table, advisory label) honored — no schema/route-path/SDK/money changes. Spec §7 verification = Task 6.

**Placeholder scan:** none — every code/test step has complete content and exact run commands.

**Type/shape consistency:** `getCodeSessionSpendAggregation` returns `{ period, total_cost_usd, total_cache_savings_usd, session_count, by_day, by_project }` (Task 1) — consumed by `getClaudeCodeSpend` as `code_sessions` with `.total_cost_usd` → `code_total_usd` (Task 2); route returns that object (Task 3); page reads `data.code_total_usd`, `data.code_sessions.total_cache_savings_usd`, `.session_count`, `.by_day[].cost_usd`, `.by_project[].project_name/.cost_usd` (Task 5) — all aligned. Lens tag `'claude_code'` (JSON) vs slug `'claude-code'` (URL/route) used consistently.

**Scope:** single subsystem, additive, no Phase-C (money) surfaces. In scope for one plan.
