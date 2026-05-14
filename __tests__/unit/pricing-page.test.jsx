import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

const { mockSql, mockCountVerifiedIntegrations } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockCountVerifiedIntegrations: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/monetization.repository.js', () => ({
  countVerifiedIntegrations: mockCountVerifiedIntegrations,
}));

// PublicNavbar + PublicFooter live in .js files that contain JSX — vitest's
// oxc parser refuses to transform JSX-in-.js, so stub them out for the test.
// The page's *own* monetization surface (which we care about asserting on) is
// untouched by this mock.
vi.mock('@/components/PublicNavbar', () => ({
  default: () => null,
}));
vi.mock('@/components/PublicFooter', () => ({
  default: () => null,
}));

// Import AFTER mocks.
import PricingPage from '@/pricing/page.jsx';

beforeEach(() => {
  vi.clearAllMocks();
});

async function renderPage() {
  const element = await PricingPage();
  return renderToString(element);
}

describe('/pricing page — MON-01 commitment (D-03 location 1)', () => {
  it('renders the exact trigger commitment text', async () => {
    mockCountVerifiedIntegrations.mockResolvedValue(7);
    const html = await renderPage();
    expect(html).toContain('50 verified coding-agent integrations');
  });

  it('renders live counter in N/50 format (accepts "7 / 50" or "7/50"; rejects literal "N/50")', async () => {
    mockCountVerifiedIntegrations.mockResolvedValue(7);
    const html = await renderPage();
    expect(html).toMatch(/\d+\s*\/\s*50/);
    expect(html).not.toMatch(/N\/50/);
  });

  it('renders all 5 D-05 Free-tier bullets (locked decision — not 3-of-5)', async () => {
    mockCountVerifiedIntegrations.mockResolvedValue(7);
    const html = await renderPage();
    const low = html.toLowerCase();

    // 5 D-05 bullets. Each may be covered by multiple substrings; collapse to
    // 5 distinct bullets and assert all 5 present.
    const bullets = [
      { id: 'cc-integration', match: /claude code/i.test(html) && /solo-dev|integration/i.test(html) },
      { id: 'approvals',      match: /discord/i.test(html) && /telegram/i.test(html) },
      { id: 'ledger',         match: /\/decisions/i.test(html) || /decisions? ledger/i.test(html) },
      { id: 'semantic-guard', match: /semantic guard/i.test(html) },
      { id: 'activity',       match: /\/activity/i.test(html) && /\/my-agent/i.test(html) },
    ];
    const covered = bullets.filter((b) => b.match).map((b) => b.id);
    expect(covered.length).toBe(5);

    // Separately: "Free forever" phrase present (positioning signal).
    expect(low).toContain('free forever');
  });

  it('renders all 4 D-06 Pro-tier bullets (locked decision — not 3-of-4)', async () => {
    mockCountVerifiedIntegrations.mockResolvedValue(7);
    const html = await renderPage();

    const bullets = [
      { id: 'multi-user',  match: /multi-user/i.test(html) && /sso/i.test(html) },
      { id: 'policy-pack', match: /policy pack/i.test(html) || /custom polic/i.test(html) },
      { id: 'audit',       match: /audit export/i.test(html) || /soc.?2/i.test(html) },
      { id: 'integrations',match: /cursor|aider|devin|beyond claude code/i.test(html) },
    ];
    const covered = bullets.filter((b) => b.match).map((b) => b.id);
    expect(covered.length).toBe(4);
  });

  it('contains NO paywall/buy-CTA language (D-07 negative assertion)', async () => {
    mockCountVerifiedIntegrations.mockResolvedValue(7);
    const html = await renderPage();
    expect(html).not.toMatch(/buy now|upgrade now|subscribe|purchase|checkout|pay now/i);
  });

  it('uses brand orange sparingly — present on counter, not as page-body background', async () => {
    mockCountVerifiedIntegrations.mockResolvedValue(7);
    const html = await renderPage();

    // Counter number should use text-brand (orange as signal per .impeccable.md)
    expect(html).toMatch(/text-brand/);
    // Page body should NOT use bg-brand anywhere (orange-as-wallpaper anti-pattern)
    expect(html).not.toMatch(/class="[^"]*\bbg-brand\b[^"]*"/);
  });

  it('fail-graceful: renders "—" fallback when repository throws (T-03-03-02 — no leak)', async () => {
    mockCountVerifiedIntegrations.mockRejectedValue(new Error('db down'));
    const html = await renderPage();

    // Page still renders (does not throw)
    expect(html).toContain('50 verified coding-agent integrations');
    // Counter renders the em-dash fallback instead of a number
    expect(html).toMatch(/—\s*\/\s*50/);
    // And exposes no error detail
    expect(html).not.toContain('db down');
  });

  it('no hardcoded hex colors (CLAUDE.md + .impeccable.md token-first rule)', async () => {
    mockCountVerifiedIntegrations.mockResolvedValue(7);
    const html = await renderPage();

    // Scan inline style attributes and class names for hex literals.
    // Images and external assets are allowed; only flag inline CSS.
    const inlineHex = html.match(/style="[^"]*#[0-9a-fA-F]{3,6}[^"]*"/g) || [];
    expect(inlineHex).toEqual([]);
  });

  it('response shape sanity — server-side repository call, not HTTP fetch', async () => {
    mockCountVerifiedIntegrations.mockResolvedValue(7);
    await renderPage();
    expect(mockCountVerifiedIntegrations).toHaveBeenCalled();
  });
});
