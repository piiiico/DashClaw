// app/setup/composeInstanceStatus.js

/**
 * Normalizes raw outputs from getSetupStatus() and getAuthConfig()
 * into a single instanceStatus object for the /setup page.
 *
 * @param {object} dbStatus  - return value of getSetupStatus()
 * @param {object} authConfig - return value of getAuthConfig()
 * @returns {{ db, auth, overall }}
 */
export function composeInstanceStatus(dbStatus: any, authConfig: any) {
  const db = {
    ok: Boolean(dbStatus.configured),
    reason: dbStatus.configured ? 'ready' : (dbStatus.reason || 'unknown'),
    message: dbStatus.message || '',
    missing: Array.isArray(dbStatus.missing) ? dbStatus.missing : [],
  };

  // Build method name list: OAuth provider display names + "Local password" if set
  const methods = [
    ...(authConfig.oauthProviders || []).map((p: any) => p.name),
    ...(authConfig.hasLocalPassword ? ['Local password'] : []),
  ];

  const auth = {
    ok: Boolean(authConfig.hasAnySignInMethod),
    methods,
    hasAny: Boolean(authConfig.hasAnySignInMethod),
  };

  let overall;
  if (!db.ok) {
    overall = 'not_configured';
  } else if (!auth.ok) {
    overall = 'partial';
  } else {
    overall = 'ready';
  }

  return { db, auth, overall };
}
