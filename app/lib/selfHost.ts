/**
 * Self-host mode detection helper.
 *
 * Shared by middleware.js and API route handlers to short-circuit
 * org_default access checks on self-hosted Postgres deployments.
 *
 * Ported from Elpolini's fork (elpolini/DashClaw commit dbf5463) and
 * Lief's fork (RyanTJoy/DashClaw commit 49c8ae3).
 */

/**
 * Returns true when DASHCLAW_MODE is 'self_host' (the default).
 * Used to bypass org_default guards that assume a Neon-backed deployment.
 */
export function isSelfHostModeEnabled(): boolean {
  const mode = (process.env.DASHCLAW_MODE || 'self_host').toLowerCase();
  return mode === 'self_host';
}
