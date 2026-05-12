import { OVERALL_STATE_META } from './constants.mjs';
import { createStep, createWorkflowStep } from './factories.mjs';
import {
  buildSetupMigrationCommands,
  SETUP_READINESS_MIGRATION_SCRIPTS,
} from '../setup/runtime-prerequisites.mjs';

export function buildWorkflow(report) {
  const coreReady = report.db.ok && report.config.ok;
  const authReady = report.auth.ok;
  const apiReady = report.auth.hasAgentApiKey;
  const requiredMissing = report.config.missingRequired.length > 0;
  const hasLiveProof = Boolean(report.sdk?.hasLiveProof);

  return [
    createWorkflowStep({
      id: 'core_instance',
      title: 'Core instance verification',
      status: coreReady ? 'pass' : requiredMissing || !report.db.ok ? 'fail' : 'warn',
      summary: coreReady
        ? 'DashClaw rendered, required config is present, and database checks completed.'
        : 'Core instance verification is not complete yet.',
      proof: coreReady
        ? 'Verified by page reachability, config presence checks, database connectivity, and core schema inspection.'
        : 'Blocked until required config and database checks pass.',
      nextAction: coreReady ? '' : 'Resolve the blocked checks in Configuration and Database first.',
    }),
    createWorkflowStep({
      id: 'auth_operator',
      title: 'Operator and auth verification',
      status: authReady ? (apiReady ? 'pass' : 'warn') : 'warn',
      summary: authReady
        ? 'At least one operator sign-in path is configured.'
        : 'Normal operator sign-in still needs setup.',
      proof: authReady
        ? 'Verified by checking complete sign-in provider configuration.'
        : 'Only inferred as incomplete because no complete sign-in method was found.',
      nextAction: authReady
        ? apiReady
          ? ''
          : 'Add or generate an API key before running the connection test.'
        : 'Finish local password or OAuth setup before relying on dashboard access.',
    }),
    createWorkflowStep({
      id: 'sdk_live',
      title: 'SDK and integration verification',
      status: !coreReady ? 'blocked' : hasLiveProof ? 'pass' : apiReady ? 'pending' : 'warn',
      summary: !coreReady
        ? 'Live SDK validation should wait until core checks pass.'
        : hasLiveProof
          ? 'Live SDK proof has been captured for this verify view.'
        : apiReady
          ? 'Open the Settings page and use the "Test your connection" panel — paste your API key and click "Run test" — to capture live proof.'
          : 'Core checks are in place, but you still need an API key for live validation.',
      proof: hasLiveProof
        ? report.sdk.evidenceSummary
        : !coreReady
        ? 'No live SDK proof collected yet.'
        : 'Use the "Test your connection" panel on the Settings page to prove authenticated API access.',
      nextAction: !coreReady
        ? 'Complete the core verification step first.'
        : hasLiveProof
          ? 'Download the refreshed proof artifact or share the setup URL with the attached live proof token.'
        : apiReady
          ? 'On the Settings page, paste your API key into the "Test your connection" panel and click "Run test" to validate and capture proof.'
          : 'Generate an API key on the API Keys page, then use the "Test your connection" panel on Settings to validate.',
    }),
    createWorkflowStep({
      id: 'proof_artifact',
      title: 'Verification proof artifact',
      status: 'pass',
      summary: 'A structured JSON artifact is available for the current verification view.',
      proof: 'The artifact records timestamp, mode, overall state, categories checked, per-check status, and next steps.',
      nextAction: 'Download the proof artifact once you are ready to share or archive the current verification state.',
    }),
  ];
}

export function buildRecommendations(report) {
  const steps = [];
  const hasLiveProof = Boolean(report.sdk?.hasLiveProof);
  const readinessMigrationCommands = buildSetupMigrationCommands(SETUP_READINESS_MIGRATION_SCRIPTS).join('\n');

  if (report.config.missingRequired.length > 0) {
    steps.push(
      createStep({
        id: 'set_required_env',
        title: 'Set required environment variables',
        variant: 'error',
        summary: `DashClaw is missing ${report.config.missingRequired.length} required setting(s).`,
        details: report.config.missingRequired.map((entry) => `${entry.key}: ${entry.help}`),
      })
    );
  }

  if (report.db.reason === 'missing_database_url') {
    steps.push(
      createStep({
        id: 'set_database_url',
        title: 'Set DATABASE_URL',
        variant: 'error',
        summary: 'DashClaw cannot start database verification until DATABASE_URL is configured.',
        details: [
          'What failed: no database connection string was present.',
          'Likely cause: the deployment is missing its database connection string.',
          'Next action: add DATABASE_URL to your environment and restart or redeploy.',
        ],
        code: 'DATABASE_URL=postgres://user:password@localhost:5432/dashclaw',
        publicCode: '',
        note: 'Use the real connection string from your Postgres deployment. Do not paste secrets into shared screenshots.',
      })
    );
  }

  if (report.db.reason === 'connection_error') {
    steps.push(
      createStep({
        id: 'fix_database_connection',
        title: 'Fix database connectivity',
        variant: 'error',
        summary: 'DashClaw found DATABASE_URL but could not connect to the database.',
        details: [
          'What failed: the live database connection attempt did not succeed.',
          'Likely cause: the database is offline, unreachable from this deployment, or using invalid credentials.',
          'Next action: verify DATABASE_URL, confirm the database is reachable, then reload /setup.',
        ],
        code: `# Confirm the database is reachable from this environment
node scripts/_run-with-env.mjs scripts/migrate-multi-tenant.mjs`,
        publicCode: '',
        note: 'If migrations have never been run, start with the bootstrap migration once connectivity is fixed.',
      })
    );
  }

  if (report.db.reason === 'no_tables') {
    steps.push(
      createStep({
        id: 'run_migrations',
        title: 'Run setup migrations',
        variant: 'warn',
        summary: 'The database is reachable, but DashClaw schema setup is incomplete.',
        details: [
          'What failed: one or more required core tables are still missing.',
          'Likely cause: bootstrap migrations have not run, or they only ran partially.',
          'Next action: run the migration commands, then reload /setup.',
        ],
        code: readinessMigrationCommands,
        publicCode: 'Sign in for the exact migration commands.',
        note: report.db.missing.length > 0 ? `Missing tables: ${report.db.missing.join(', ')}` : '',
        publicNote: `${report.db.missing.length} required schema check(s) are still failing.`,
      })
    );
  }

  if (!report.auth.ok) {
    steps.push(
      createStep({
        id: 'configure_auth',
        title: 'Configure a sign-in method',
        variant: 'warn',
        summary: 'Operators need at least one complete sign-in method before normal dashboard access will work.',
        details: [
          'What failed: no complete operator sign-in path is configured.',
          'Likely cause: neither local password login nor a fully configured OAuth provider is available yet.',
          'Next action: set DASHCLAW_LOCAL_ADMIN_PASSWORD for solo access, or finish GitHub, Google, or OIDC setup.',
        ],
        code: `DASHCLAW_LOCAL_ADMIN_PASSWORD=change-me
NEXTAUTH_SECRET=$(openssl rand -base64 32)`,
        publicCode: 'DASHCLAW_LOCAL_ADMIN_PASSWORD=<set-a-strong-password>',
      })
    );
  }

  if (report.config.ok && report.auth.ok && report.config.missingAdvisory.length > 0) {
    steps.push(
      createStep({
        id: 'finish_recommended_env',
        title: 'Finish recommended configuration',
        variant: 'info',
        summary: 'DashClaw can run, but a few optional settings will improve reliability and integrations.',
        details: report.config.missingAdvisory.map((entry) => `${entry.key}: ${entry.help}`),
      })
    );
  }

  if (report.db.ok && report.config.ok) {
    steps.push(
      createStep({
        id: 'run_sdk_validation',
        title: hasLiveProof ? 'Live SDK proof captured' : 'Validate your connection',
        variant: hasLiveProof ? 'info' : report.auth.hasAgentApiKey ? 'info' : 'warn',
        summary: hasLiveProof
          ? 'A successful live validation result is attached to this verify view.'
          : report.auth.hasAgentApiKey
          ? 'Core verification passed. On the Settings page, use the "Test your connection" panel to validate and capture proof.'
          : 'Core verification passed, but you still need an API key before validation can succeed.',
        details: hasLiveProof
          ? [
              `Captured proof: ${report.sdk.evidenceSummary}`,
              'Next action: download the refreshed JSON proof artifact or keep the signed setup URL for operational handoff.',
            ]
          : report.auth.hasAgentApiKey
          ? [
              'What this proves: real API ingress, authentication, and a live request path.',
              'Next action: open the Settings page, paste your API key into the "Test your connection" panel, and click "Run test".',
            ]
          : [
              'What is pending: live proof still depends on an API key.',
              'Next action: generate an API key on the API Keys page, then use the "Test your connection" panel on Settings to validate.',
            ],
      })
    );
  }

  if (steps.length === 0) {
    steps.push(
      createStep({
        id: 'instance_verified',
        title: 'Instance verification looks strong',
        variant: 'info',
        summary: 'Core verification checks are passing and operator access looks ready.',
        details: ['Next action: download the JSON proof artifact, or use the "Test your connection" panel on the Settings page for additional live proof.'],
      })
    );
  }

  return steps;
}

export function buildVerificationState(report) {
  const hasBlockingFailure = !report.db.ok || !report.config.ok;
  if (hasBlockingFailure) {
    return {
      overall: 'blocked',
      ...OVERALL_STATE_META.blocked,
      ready: false,
      fullyVerified: false,
    };
  }

  const hasAttentionIssue =
    !report.auth.ok ||
    report.config.missingAdvisory.length > 0 ||
    report.auth.hasPartialProviderWarnings;

  if (hasAttentionIssue) {
    return {
      overall: 'needs_attention',
      ...OVERALL_STATE_META.needs_attention,
      ready: false,
      fullyVerified: false,
    };
  }

  // Accept either a live proof token OR an API key + recorded actions as verified
  const hasLiveProof = Boolean(report.sdk?.hasLiveProof);
  const hasApiKeyAndActions = report.auth.hasAgentApiKey && report.hasRecordedActions;
  if (!hasLiveProof && !hasApiKeyAndActions) {
    return {
      overall: 'ready_unverified',
      ...OVERALL_STATE_META.ready_unverified,
      ready: true,
      fullyVerified: false,
    };
  }

  return {
    overall: 'verified',
    ...OVERALL_STATE_META.verified,
    ready: true,
    fullyVerified: true,
  };
}

export function buildProofArtifact(view, host) {
  const categories = view.sections.map((section) => ({
    id: section.id,
    title: section.title,
    status: section.status,
    summary: section.summary,
    what_was_checked: section.whatWasChecked,
    evidence_summary: section.evidenceSummary,
    pending_proof: section.pendingProof,
    checks: section.checks.map((check) => ({
      id: check.id,
      label: check.label,
      status: check.status,
      detail: check.detail,
      sub_detail: check.subDetail,
      likely_cause: check.likelyCause,
      next_action: check.nextAction,
    })),
  }));

  return {
    artifact_version: 1,
    generated_at: new Date().toISOString(),
    checked_at: view.checkedAt,
    route: '/setup',
    viewer_mode: view.mode,
    host: host || '',
    verification: {
      overall: view.verification.overall,
      label: view.verification.label,
      summary: view.verification.summary,
      ready: view.verification.ready,
      fully_verified: view.verification.fullyVerified,
      readiness_status: view.overall,
    },
    runtime: {
      node_version: process.version,
      node_env: process.env.NODE_ENV || 'development',
    },
    categories,
    workflow: view.workflow.map((step) => ({
      id: step.id,
      title: step.title,
      status: step.status,
      summary: step.summary,
      proof: step.proof,
      next_action: step.nextAction,
    })),
    recommended_next_steps: view.recommendations.map((step) => ({
      id: step.id,
      title: step.title,
      variant: step.variant,
      summary: step.summary,
      details: step.details,
      code: step.code,
      note: step.note,
    })),
    sdk_validation: view.sdk?.commands
      ? {
          base_url: view.sdk.commands.baseUrl,
          node_command: view.sdk.commands.node,
          python_command: view.sdk.commands.python,
          live_proof: view.sdk.liveProof
            ? {
                tool: view.sdk.liveProof.tool,
                mode: view.sdk.liveProof.mode,
                captured_at: view.sdk.liveProof.capturedAt,
                summary: view.sdk.liveProof.summary,
                proof_statement: view.sdk.liveProof.proofStatement,
                checks: view.sdk.liveProof.checks,
              }
            : null,
          note: view.sdk.liveProof
            ? 'This artifact includes a signed live validation proof token summary for the current verify view.'
            : 'These commands are guidance for live validation. The artifact does not claim they have already been executed.',
        }
      : null,
    notice: view.notice || '',
  };
}


export function projectAuthConfig(auth, isAuthenticated) {
  if (isAuthenticated) return auth;

  return {
    ...auth,
    config: {
      hasGitHub: auth.config.hasGitHub,
      hasGoogle: auth.config.hasGoogle,
      hasOIDC: auth.config.hasOIDC,
      hasLocalPassword: auth.config.hasLocalPassword,
      hasAnyOAuth: auth.config.hasAnyOAuth,
      hasAnySignInMethod: auth.config.hasAnySignInMethod,
      oauthProviders: auth.config.oauthProviders,
      providerChecks: (auth.config.providerChecks || []).map((provider) => ({
        id: provider.id,
        name: provider.name,
        configured: provider.configured,
        partiallyConfigured: provider.partiallyConfigured,
        missingKeys: provider.partiallyConfigured ? ['Hidden until sign-in'] : [],
      })),
    },
  };
}

export function projectCheck(check, isAuthenticated) {
  return {
    ...check,
    detail: isAuthenticated ? check.detail : check.publicDetail,
    subDetail: isAuthenticated ? check.subDetail : check.publicSubDetail,
  };
}

export function projectStep(step, isAuthenticated) {
  return {
    ...step,
    code: isAuthenticated ? step.code : step.publicCode,
    note: isAuthenticated ? step.note : step.publicNote,
  };
}
