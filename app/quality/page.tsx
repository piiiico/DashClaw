'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * /quality redirects to /scoring (Scoring Profiles) by default,
 * or /evaluations if ?view=evaluations is passed.
 *
 * This is the merged "Quality" entry point from the sidebar.
 * Both /scoring and /evaluations remain fully functional standalone pages.
 */
function QualityRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get('view');

  useEffect(() => {
    if (view === 'evaluations') {
      router.replace('/evaluations');
    } else {
      router.replace('/scoring');
    }
  }, [router, view]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="h-8 w-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function QualityPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="h-8 w-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <QualityRedirect />
    </Suspense>
  );
}
