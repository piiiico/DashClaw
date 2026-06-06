'use client';

import React from 'react';
import Link from 'next/link';
import { trackMarketingEvent } from '../lib/marketingTrack';

/**
 * Drop-in replacement for Next Link that fires a marketing event on
 * click before navigation. trackMarketingEvent uses navigator.sendBeacon
 * so the event survives the navigation.
 *
 * Forwards all other props through to next/link.
 */
interface TrackedLinkProps {
  event?: any;
  properties?: any;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  children?: React.ReactNode;
  [key: string]: any;
}

export default function TrackedLink({ event, properties, onClick, children, ...rest }: TrackedLinkProps) {
  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    trackMarketingEvent(event, properties);
    if (typeof onClick === 'function') onClick(e);
  }

  return (
    <Link {...(rest as React.ComponentProps<typeof Link>)} onClick={handleClick}>
      {children}
    </Link>
  );
}
