'use client';

import { useEffect } from 'react';
import { trackMarketingEvent } from '../lib/marketingTrack';

interface MarketingViewObserverProps {
  targetId?: string;
  event?: string;
  threshold?: number;
}

/**
 * Fires a marketing event the first time the target element scrolls
 * into view. Uses IntersectionObserver. Fires at most once per page
 * load (per `event` name).
 *
 * Use:
 *   <MarketingViewObserver
 *     targetId="vs-alternatives"
 *     event="marketing_vs_section_viewed"
 *   />
 */
export default function MarketingViewObserver({ targetId, event, threshold = 0.4 }: MarketingViewObserverProps) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof IntersectionObserver === 'undefined') return;

    const target = document.getElementById(targetId as string);
    if (!target) return;

    let fired = false;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !fired) {
            fired = true;
            trackMarketingEvent(event);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [targetId, event, threshold]);

  return null;
}
