import { NextResponse } from 'next/server';

/**
 * Shared API error handler that detects common deployment issues
 * and returns actionable messages instead of generic 500s.
 *
 * Usage: catch (err) { return apiErrorResponse(err, 'GUARD'); }
 */
export function apiErrorResponse(err: any, label: string): NextResponse {
  console.error(`[${label}] error:`, err);

  // PostgreSQL 42P01: undefined_table — schema not initialized
  if (err.code === '42P01') {
    return NextResponse.json({
      error: 'Database schema not initialized. Visit /setup or redeploy to trigger auto-migration.',
      code: 'SCHEMA_NOT_INITIALIZED',
      setup_url: '/setup',
    }, { status: 503 });
  }

  // PostgreSQL 42P04: duplicate_database, 42000: syntax_error_or_access_rule_violation
  // PostgreSQL 08xxx: connection errors
  if (err.code && err.code.startsWith('08')) {
    return NextResponse.json({
      error: 'Database connection failed. Check DATABASE_URL in your environment variables.',
      code: 'DB_CONNECTION_FAILED',
      setup_url: '/setup',
    }, { status: 503 });
  }

  // DATABASE_URL not set
  if (err.message?.includes('DATABASE_URL is not set')) {
    return NextResponse.json({
      error: 'DATABASE_URL is not configured. Add it in your Vercel project settings and redeploy.',
      code: 'DB_NOT_CONFIGURED',
      setup_url: '/setup',
    }, { status: 503 });
  }

  // Surface the real error so we can actually diagnose issues.
  // Never leak stack traces, but the message itself is useful.
  const detail = err.message || String(err);
  return NextResponse.json({
    error: 'Internal server error',
    detail,
    code: err.code || undefined,
  }, { status: 500 });
}
