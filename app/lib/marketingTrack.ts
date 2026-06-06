/**
 * Client-side helper for posting marketing-funnel events to
 * /api/marketing/event. Designed to be cheap and fire-and-forget:
 *
 * - Uses navigator.sendBeacon when available so the request survives
 *   page navigation (important for the hero CTA, which navigates away
 *   the moment the button is clicked).
 * - Falls back to fetch with keepalive when sendBeacon is unavailable.
 * - Swallows errors. Marketing telemetry must never break the page.
 *
 * Server-side import is harmless; the function checks for window before
 * touching browser APIs and is a no-op outside the browser.
 */

const ENDPOINT = '/api/marketing/event';

export function trackMarketingEvent(
  event: string,
  properties?: Record<string, unknown> | null,
): void {
  if (typeof window === 'undefined') return;

  const body = JSON.stringify({
    event,
    properties: properties && typeof properties === 'object' ? properties : {},
  });

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      const sent = navigator.sendBeacon(ENDPOINT, blob);
      if (sent) return;
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Telemetry failures must never propagate.
  }
}
