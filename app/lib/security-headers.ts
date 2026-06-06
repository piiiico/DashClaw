/**
 * Per-response security headers applied by middleware.js.
 *
 * Extracted from middleware.js so unit tests can import the real function
 * instead of mirroring an inlined copy that silently drifts. The static
 * Next.js header config (CSP, HSTS, etc.) lives separately in
 * next-config-headers.cjs because next.config.js is CommonJS.
 */

interface ResponseWithHeaders {
  headers: {
    set(name: string, value: string): void;
    delete(name: string): void;
  };
}

interface RequestWithUrl {
  nextUrl?: { pathname?: string } | null;
}

export function addSecurityHeaders<T extends ResponseWithHeaders>(
  response: T,
  request: RequestWithUrl | null | undefined,
): T {
  const pathname = request?.nextUrl?.pathname || '';
  const isPublicReplay = pathname.startsWith('/replay/');

  response.headers.set('X-Content-Type-Options', 'nosniff');

  if (isPublicReplay) {
    // Allow embedding for public replays
    response.headers.delete('X-Frame-Options');
    response.headers.set('Content-Security-Policy', 'frame-ancestors *;');
  } else {
    response.headers.set('X-Frame-Options', 'DENY');
  }

  response.headers.set('X-XSS-Protection', '1; mode=block');
  // SECURITY: Apply HSTS in production to prevent protocol downgrade attacks
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  return response;
}
