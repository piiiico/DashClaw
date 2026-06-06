export function isDemoMode(): boolean {
  // Primary signal: build-time client env.
  if (process.env.NEXT_PUBLIC_DASHCLAW_MODE === 'demo') return true;

  // Fallback: cookie set by /demo (works even if env wasn't set on the deployment).
  if (typeof document !== 'undefined') {
    const isDemoCookie = document.cookie.split(';').some(c => c.trim() === 'dashclaw_demo=1');
    if (!isDemoCookie) return false;

    // SECURITY: Only honor demo cookie on dashclaw.io to prevent accidental self-host lockout/confusion.
    const host = window.location.hostname;
    const isMarketingHost =
      host === 'dashclaw.io' || host.endsWith('.dashclaw.io');

    return isMarketingHost;
  }

  return false;
}
