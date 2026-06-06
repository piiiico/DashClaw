export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { getViewerContextFromCookieHeader } from '../../../lib/sessionViewer.mjs';

// BUG-03b: /approvals and other admin-gated UIs used `useSession()` from
// next-auth to derive `isAdmin`, which only reads the NextAuth JWT cookie.
// Users authenticated via the local-password path (POST /api/auth/local)
// hold a `dashclaw-local-session` cookie with `role: 'admin'` baked into
// the JWT payload — useSession ignores it, so those admins were rendered
// as members. This endpoint returns the unified viewer role that
// respects both auth paths by delegating to getViewerContextFromCookieHeader.
export async function GET(request: Request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const viewer = await getViewerContextFromCookieHeader(cookieHeader, process.env);
  const role = viewer.session?.role || null;
  return Response.json({
    authenticated: viewer.isAuthenticated,
    authType: viewer.authType,
    role,
    isAdmin: role === 'admin',
  });
}
