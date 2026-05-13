'use client';

import Link from 'next/link';
import { trackMarketingEvent } from '../lib/marketingTrack';

/**
 * Drop-in replacement for Next Link that fires a marketing event on
 * click before navigation. trackMarketingEvent uses navigator.sendBeacon
 * so the event survives the navigation.
 *
 * Forwards all other props through to next/link.
 */
export default function TrackedLink({ event, properties, onClick, children, ...rest }) {
  function handleClick(e) {
    trackMarketingEvent(event, properties);
    if (typeof onClick === 'function') onClick(e);
  }

  return (
    <Link {...rest} onClick={handleClick}>
      {children}
    </Link>
  );
}
