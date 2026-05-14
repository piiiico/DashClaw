/**
 * /pricing — MON-01 public commitment page (D-03 location 1 of 4).
 *
 * Renders the "50 verified Claude Code integrations" trigger commitment,
 * a live N/50 counter sourced from countVerifiedIntegrations, the Free-forever
 * scope (D-05), and the Pro-when-fires scope (D-06).
 *
 * This is NOT a paywall. D-07 defers paid-CTA shipping until MON-01 fires.
 * The page explicitly avoids buy/upgrade/subscribe/pay language.
 *
 * Added by Plan 03-03.
 */

import Link from 'next/link';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import { getSql } from '../lib/db.js';
import { countVerifiedIntegrations } from '../lib/repositories/monetization.repository.js';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Pricing — DashClaw',
  description:
    'DashClaw is free while we grow. Pro tier launches when we hit 50 verified Claude Code integrations in the wild.',
};

async function getCount() {
  try {
    const sql = getSql();
    return await countVerifiedIntegrations(sql);
  } catch {
    return null;
  }
}

export default async function PricingPage() {
  const count = await getCount();
  const counterDisplay = count === null ? '—' : String(count);

  const freeBullets = [
    'Solo-dev coding-agent integrations — Claude Code, Codex, Hermes Agent (hook + policy pack).',
    'Discord + Telegram approvals from your phone.',
    '/decisions ledger with full replay.',
    'Semantic guard (bring your own LLM key).',
    '/activity + /my-agent timelines.',
  ];

  const proBullets = [
    'Multi-user orgs + SSO + role-based policies.',
    'Custom policy pack authoring.',
    'Audit export + SOC 2-friendly reporting.',
    'Integrations beyond Claude Code, Codex, and Hermes (Cursor, Aider, Devin, custom SDK).',
  ];

  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      <PublicNavbar />

      <main className="px-6 pb-20 pt-28">
        <div className="mx-auto max-w-3xl">
          <header className="mb-10">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-tertiary">
              Pricing
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              DashClaw is free while we grow.
            </h1>
            <p className="mt-4 text-base text-text-secondary">
              The runtime — hook, policy pack, Discord approvals, audit ledger,
              semantic guard — stays free forever for solo devs. There is
              nothing to buy on this page today.
            </p>
          </header>

          <section
            aria-label="Monetization trigger commitment"
            className="mb-10 rounded-3xl border border-border bg-surface-secondary p-6 sm:p-8"
          >
            <h2 className="text-xl font-semibold tracking-tight">
              Pro tier launches when DashClaw hits 50 verified coding-agent
              integrations in the wild.
            </h2>
            <p className="mt-3 text-sm text-text-secondary">
              Counts Claude Code, Codex, and Hermes Agent installs against the
              same threshold. Measured by a public SQL query over <code className="rounded border border-border bg-surface-tertiary px-1 py-0.5 font-mono text-[11px]">action_records</code> where
              {' '}<code className="rounded border border-border bg-surface-tertiary px-1 py-0.5 font-mono text-[11px]">agent_id ILIKE &apos;claude-code%&apos; OR &apos;codex%&apos; OR &apos;hermes%&apos;</code>,
              excluding internal orgs, with a 90-day recency window. No
              time-boxed backstop — the trigger fires when it fires.
            </p>
            <div
              aria-label={`Progress toward trigger: ${counterDisplay} / 50`}
              className="mt-6 flex items-baseline gap-3"
            >
              {/* Keep the counter number and "/ 50" in a single text run so
                  the rendered HTML contains the literal "N / 50" (important
                  for both human readability and the /\d+\s*\/\s*50/ contract
                  enforced by __tests__/unit/pricing-page.test.jsx). Brand
                  orange is applied via a text-brand className on the number
                  only — the slash and target remain in the ambient color. */}
              <span className="font-mono text-5xl font-semibold leading-none text-text-secondary">
                <span className="text-brand">{counterDisplay}</span> / 50
              </span>
              <span className="ml-2 text-xs text-text-tertiary">
                verified integrations · live
              </span>
            </div>
          </section>

          <div className="grid gap-6 sm:grid-cols-2">
            <section
              aria-label="Free forever tier"
              className="rounded-3xl border border-border bg-surface-secondary p-6"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-tertiary">
                Today
              </p>
              <h3 className="mt-2 text-lg font-semibold">Free forever</h3>
              <p className="mt-1 text-sm text-text-secondary">
                Everything a solo developer needs to govern Claude Code.
              </p>
              <ul className="mt-5 space-y-2 text-sm text-text-secondary">
                {freeBullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="text-text-tertiary">·</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section
              aria-label="Pro tier when trigger fires"
              className="rounded-3xl border border-border bg-surface-secondary p-6"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-tertiary">
                When the counter hits 50
              </p>
              <h3 className="mt-2 text-lg font-semibold">Pro</h3>
              <p className="mt-1 text-sm text-text-secondary">
                What lands the day MON-01 fires. Nothing to do today — the
                infrastructure is already built and dormant.
              </p>
              <ul className="mt-5 space-y-2 text-sm text-text-secondary">
                {proBullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="text-text-tertiary">·</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <footer className="mt-10 rounded-3xl border border-border bg-surface-secondary p-6 sm:p-8">
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-text-tertiary">
              Why we commit publicly
            </h3>
            <p className="mt-3 text-sm text-text-secondary">
              This commitment also lives in our{' '}
              <Link
                href="https://github.com/ucsandman/DashClaw/blob/main/.planning/PROJECT.md"
                className="text-text-primary underline decoration-border hover:decoration-text-primary"
              >
                PROJECT.md
              </Link>
              , our{' '}
              <Link
                href="https://github.com/ucsandman/DashClaw#readme"
                className="text-text-primary underline decoration-border hover:decoration-text-primary"
              >
                README
              </Link>
              , and our launch tweet plus HN post. If we renege, it costs
              reputation, not just a private retro.
            </p>
          </footer>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
