'use client';

import { useEffect, useRef } from 'react';
import { trackMarketingEvent } from '../lib/marketingTrack';

/**
 * Fires a single marketing event on mount. Used by pages that want a
 * page-load telemetry signal without converting the whole page into a
 * client component.
 *
 * Use:
 *   <MarketingPageView event="marketing_self_host_visited" />
 */
export default function MarketingPageView({ event, properties }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackMarketingEvent(event, properties);
  }, [event, properties]);
  return null;
}
