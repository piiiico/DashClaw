import Link from 'next/link';
import { headers } from 'next/headers';
import { getSql } from '../lib/db.js';
import { getReadinessReport, projectConnectNextStep, projectReadinessReport } from '../lib/readiness.mjs';
import { readLiveVerificationProofToken } from '../lib/liveVerificationProof.mjs';
import { getViewerContextFromCookieHeader } from '../lib/sessionViewer.mjs';
import { createFallbackOnboardingStatus, getOnboardingStatusForUserId, getViewerUserId } from '../lib/onboardingState.mjs';

import { ModeBadge } from './components/Common.js';
import { TopSummary } from './components/TopSummary.js';
import { ConnectNextStepPanel } from './components/ConnectNextStepPanel.js';
import { WorkflowPanel } from './components/WorkflowPanel.js';
import { VerificationSection } from './components/VerificationSection.js';
import { RecommendedSteps } from './components/RecommendedSteps.js';
import { ProofPanel } from './components/ProofPanel.js';
import { ApiKeyReveal } from './components/ApiKeyReveal.js';
import ModelPricingPanel from './components/ModelPricingPanel.js';
import AgentIdentityPanel from './components/AgentIdentityPanel';
import WorkspaceIdentityPanel from './components/WorkspaceIdentityPanel.js';
import PageLayout from '../components/PageLayout';
import { LogIn } from 'lucide-react';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Settings - DashClaw',
};

function getMaskedApiKey(env) {
  const key = env.DASHCLAW_API_KEY;
  if (!key) return '';
  return key.slice(0, 8) + '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
}

export default async function SettingsPage({ searchParams }) {
  const headerStore = await headers();
  const host = headerStore.get('host') || 'localhost';
  const cookieHeader = headerStore.get('cookie') || '';
  const resolvedSearchParams = await searchParams;
  const tab = resolvedSearchParams?.tab || 'setup';
  const liveProofToken = typeof resolvedSearchParams?.proof === 'string' ? resolvedSearchParams.proof : '';

  const viewer = await getViewerContextFromCookieHeader(cookieHeader, process.env);
  const liveProof = await readLiveVerificationProofToken(liveProofToken, process.env);
  const report = await getReadinessReport(process.env, { host, liveProof });
  const view = projectReadinessReport(report, {
    isAuthenticated: viewer.isAuthenticated,
    host,
  });
  let onboarding = null;
  if (viewer.isAuthenticated) {
    try {
      onboarding = await getOnboardingStatusForUserId(getViewerUserId(viewer), {
        sql: getSql(),
        env: process.env,
      });
    } catch {
      onboarding = createFallbackOnboardingStatus();
    }
  }
  const connectNextStep = projectConnectNextStep({
    isAuthenticated: viewer.isAuthenticated,
    verification: view.verification,
    onboarding,
    host,
    sdk: view.sdk,
  });
  const proofDownloadHref = liveProofToken
    ? `/api/setup/proof?proof=${encodeURIComponent(liveProofToken)}&download=1`
    : '/api/setup/proof?download=1';

  // Workspace identity for the right-column panel. x-org-id and x-user-id
  // are injected by middleware after auth. Operators need these values
  // for integration setup (Discord, Telegram, webhooks) and there is no
  // other place in the dashboard that surfaces them today.
  const workspaceOrgId = headerStore.get('x-org-id') || '';
  const workspaceUserId = headerStore.get('x-user-id') || '';
  let workspaceOrg = null;
  if (viewer.isAuthenticated && workspaceOrgId) {
    try {
      const sql = getSql();
      const rows = await sql`
        SELECT id, name, slug, plan
        FROM organizations
        WHERE id = ${workspaceOrgId}
        LIMIT 1
      `;
      if (rows.length > 0) {
        workspaceOrg = rows[0];
      }
    } catch (err) {
      console.warn('[settings] Failed to load workspace org context:', err?.message || err);
    }
  }

  const maskedApiKey = getMaskedApiKey(process.env);
  const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  const fullHost = `${protocol}://${host}`;

  const tabs = [
    { key: 'setup', label: 'Setup & Verify', href: '/settings' },
    { key: 'pricing', label: 'Model Pricing', href: '/settings?tab=pricing' },
    { key: 'identity', label: 'Agent Identity', href: '/settings?tab=identity' },
  ];

  const quickLinks = [
    { href: '/integrations', label: 'Integrations', hint: 'Configure services' },
    { href: '/webhooks', label: 'Webhooks', hint: 'Event notifications' },
    { href: '/usage', label: 'Usage & billing', hint: 'Token spend' },
    { href: '/api-keys', label: 'API keys', hint: 'Manage keys' },
    { href: '/docs', label: 'API documentation', hint: 'Reference' },
    { href: '/self-host', label: 'Deployment guide', hint: 'Self-host docs' },
  ];

  return (
    <PageLayout
      title="Settings"
      subtitle="Instance configuration, verification, model pricing, and agent identity"
      breadcrumbs={['System', 'Settings']}
      maturity="stable"
      actions={
        <div className="flex items-center gap-2">
          {!viewer.isAuthenticated && (
            <Link
              href="/login"
              className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
            >
              <LogIn size={14} aria-hidden="true" />
              Sign in
            </Link>
          )}
          <ModeBadge isAuthenticated={viewer.isAuthenticated} />
        </div>
      }
    >
      {/* Tab bar */}
      <div role="tablist" className="mb-6 flex items-center gap-1 border-b border-border">
        {tabs.map((t) => {
          const isActive = tab === t.key;
          return (
            <a
              key={t.key}
              href={t.href}
              role="tab"
              aria-selected={isActive}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive ? 'text-white' : 'text-tertiary hover:text-secondary'
              }`}
            >
              {t.label}
              {isActive && (
                <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand" />
              )}
            </a>
          );
        })}
      </div>

      {/* Setup & Verify tab */}
      {tab === 'setup' && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Left Column: Connection & Verification */}
          <div className="space-y-6 lg:col-span-2">
            {/* Host */}
            <div className="flex items-center justify-between">
              <div className="font-mono text-[11px] tabular-nums text-tertiary">
                Host: <span className="text-secondary">{host}</span>
              </div>
            </div>

            <TopSummary view={view} proofDownloadHref={proofDownloadHref} />

            <ConnectNextStepPanel
              maskedApiKey={maskedApiKey}
              host={fullHost}
              isAuthenticated={viewer.isAuthenticated}
              overallState={view.verification.overall}
            />

            {view.notice ? (
              <div className="rounded-xl border border-border bg-surface-secondary px-5 py-4">
                <p className="text-sm text-secondary">{view.notice}</p>
              </div>
            ) : null}
            {liveProofToken && !liveProof ? (
              <div role="alert" className="rounded-xl border border-error/30 bg-error-subtle px-5 py-4">
                <p className="text-sm text-error">
                  The supplied live validation proof token could not be verified. Run the validator again and use the latest setup URL it returns.
                </p>
              </div>
            ) : null}

            {/* Verification sections */}
            <div className="space-y-4">
              {view.sections.map((section) => (
                <VerificationSection key={section.id} section={section} />
              ))}
              <RecommendedSteps recommendations={view.recommendations} />
            </div>

            <WorkflowPanel workflow={view.workflow} />
          </div>

          {/* Right Column: Quick Access */}
          <div className="space-y-6">
            {/* Workspace identity (org_id, user_id, etc. for integration setup) */}
            <WorkspaceIdentityPanel
              orgId={workspaceOrgId}
              orgName={workspaceOrg?.name}
              orgSlug={workspaceOrg?.slug}
              orgPlan={workspaceOrg?.plan}
              userId={workspaceUserId}
            />

            {/* Quick Links */}
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                Quick links
              </div>
              <div className="space-y-2">
                {quickLinks.map(link => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="group flex items-center justify-between rounded-lg border border-border bg-surface-tertiary p-3 transition-colors hover:border-border-hover"
                  >
                    <span className="text-sm text-secondary group-hover:text-white">{link.label}</span>
                    <span className="text-xs text-tertiary">{link.hint}</span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Instance Info */}
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                Instance
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-tertiary">Version</span>
                  <span className="font-mono text-xs tabular-nums text-white">v2.5</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-tertiary">Mode</span>
                  <span className={`text-xs font-medium ${view.verification?.overall === 'green' ? 'text-success' : 'text-warning'}`}>
                    {process.env.DASHCLAW_MODE === 'demo' ? 'Demo' : 'Self-hosted'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-tertiary">Database</span>
                  <span className={`text-xs font-medium ${view.sections?.find(s => s.id === 'database')?.status === 'green' ? 'text-success' : 'text-error'}`}>
                    {view.sections?.find(s => s.id === 'database')?.status === 'green' ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-tertiary">Auth</span>
                  <span className={`text-xs font-medium ${viewer.isAuthenticated ? 'text-success' : 'text-secondary'}`}>
                    {viewer.isAuthenticated ? 'Configured' : 'Not configured'}
                  </span>
                </div>
              </div>
            </div>

            {/* Environment */}
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                Environment
              </div>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-[11px] font-medium text-tertiary">Host</div>
                  <div className="break-all rounded border border-border bg-surface-tertiary p-2 font-mono text-xs text-secondary">
                    {host}
                  </div>
                </div>
                <ApiKeyReveal maskedApiKey={maskedApiKey} />
                <div>
                  <div className="mb-1 text-[11px] font-medium text-tertiary">Runtime</div>
                  <div className="rounded border border-border bg-surface-tertiary p-2 font-mono text-xs text-secondary">
                    Node {typeof process !== 'undefined' ? process.version : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Proof Panel */}
            <ProofPanel view={view} proofDownloadHref={proofDownloadHref} />

            {/* Auth Status */}
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                Session
              </div>
              {viewer.isAuthenticated ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-status-success" />
                    <span className="text-sm text-success">Authenticated</span>
                  </div>
                  <Link
                    href="/mission-control"
                    className="block rounded-lg border border-brand/20 bg-brand/10 px-4 py-2 text-center text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
                  >
                    Go to Mission Control
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-zinc-500" />
                    <span className="text-sm text-secondary">Not signed in</span>
                  </div>
                  <Link
                    href="/login"
                    className="block rounded-lg border border-border bg-surface-tertiary px-4 py-2 text-center text-sm font-medium text-secondary transition-colors hover:border-border-hover hover:text-white"
                  >
                    Sign in
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Model Pricing tab */}
      {tab === 'pricing' && (
        <ModelPricingPanel />
      )}

      {tab === 'identity' && (
        <AgentIdentityPanel highlightPairingId={resolvedSearchParams?.pairing || null} />
      )}
    </PageLayout>
  );
}
