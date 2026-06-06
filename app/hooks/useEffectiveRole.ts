'use client';

import { useEffect, useState } from 'react';

// BUG-03b: useSession() from next-auth only reads the NextAuth JWT cookie
// and ignores the `dashclaw-local-session` cookie issued by the local-
// password auth path (POST /api/auth/local). Admin-gated UIs that derived
// `isAdmin` directly from useSession rendered local-admins as read-only.
//
// This hook fetches /api/session/effective (backed by
// getViewerContextFromCookieHeader, which unifies NextAuth + local-session
// resolution) and returns the viewer's effective role. `settled` flips to
// true once the fetch resolves — gate read-only banners on `settled` so
// they don't flash during hydration.
interface EffectiveRoleState {
  role: string | null;
  authenticated: boolean;
  authType: string | null;
}

export function useEffectiveRole() {
  const [state, setState] = useState<EffectiveRoleState>({
    role: null,
    authenticated: false,
    authType: null,
  });
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/session/effective');
        if (!res.ok) throw new Error(`effective-session ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setState({
          role: json.role || null,
          authenticated: !!json.authenticated,
          authType: json.authType || null,
        });
      } catch {
        // Leave state as defaults — the caller treats that as unauthenticated.
      } finally {
        if (!cancelled) setSettled(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return {
    role: state.role,
    authenticated: state.authenticated,
    authType: state.authType,
    isAdmin: state.role === 'admin',
    settled,
  };
}
