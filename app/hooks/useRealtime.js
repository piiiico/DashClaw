'use client';

import { useEffect, useRef } from 'react';
import { useEffectiveRole } from './useEffectiveRole';
import { isDemoMode } from '../lib/isDemoMode';

// Shared EventSource per browser tab. Multiple components can subscribe without
// opening multiple /api/stream connections (which triggers backend listener warnings).
let sharedEs = null;
let sharedReconnectTimer = null;
const subscribers = new Set();

function broadcast(event, payload) {
  for (const cb of subscribers) {
    try {
      cb(event, payload);
    } catch (e) {
      // Don't let a single subscriber break realtime for everyone.
      console.warn('[realtime] subscriber error:', e?.message || e);
    }
  }
}

function attachListeners(es) {
  es.addEventListener('action.created', (e) => {
    try {
      broadcast('action.created', JSON.parse(e.data));
    } catch (err) {
      console.error('SSE Parse Error:', err);
    }
  });

  es.addEventListener('action.updated', (e) => {
    try {
      broadcast('action.updated', JSON.parse(e.data));
    } catch (err) {
      console.error('SSE Parse Error:', err);
    }
  });

  es.addEventListener('message.created', (e) => {
    try {
      broadcast('message.created', JSON.parse(e.data));
    } catch (err) {
      console.error('SSE Parse Error:', err);
    }
  });

  es.addEventListener('policy.updated', (e) => {
    try {
      broadcast('policy.updated', JSON.parse(e.data));
    } catch (err) {
      console.error('SSE Parse Error:', err);
    }
  });

  es.addEventListener('task.assigned', (e) => {
    try {
      broadcast('task.assigned', JSON.parse(e.data));
    } catch (err) {
      console.error('SSE Parse Error:', err);
    }
  });

  es.addEventListener('task.completed', (e) => {
    try {
      broadcast('task.completed', JSON.parse(e.data));
    } catch (err) {
      console.error('SSE Parse Error:', err);
    }
  });

  es.addEventListener('decision.created', (e) => {
    try {
      broadcast('decision.created', JSON.parse(e.data));
    } catch (err) {
      console.error('SSE Parse Error:', err);
    }
  });

  es.addEventListener('guard.decision.created', (e) => {
    try {
      broadcast('guard.decision.created', JSON.parse(e.data));
    } catch (err) {
      console.error('SSE Parse Error:', err);
    }
  });

  es.addEventListener('loop.created', (e) => {
    try {
      broadcast('loop.created', JSON.parse(e.data));
    } catch (err) {
      console.error('SSE Parse Error:', err);
    }
  });

  es.addEventListener('loop.updated', (e) => {
    try {
      broadcast('loop.updated', JSON.parse(e.data));
    } catch (err) {
      console.error('SSE Parse Error:', err);
    }
  });

  es.addEventListener('goal.created', (e) => {
    try {
      broadcast('goal.created', JSON.parse(e.data));
    } catch (err) {
      console.error('SSE Parse Error:', err);
    }
  });

  es.addEventListener('goal.updated', (e) => {
    try {
      broadcast('goal.updated', JSON.parse(e.data));
    } catch (err) {
      console.error('SSE Parse Error:', err);
    }
  });

  es.addEventListener('signal.detected', (e) => {
    try {
      broadcast('signal.detected', JSON.parse(e.data));
    } catch (err) {
      console.error('SSE Parse Error:', err);
    }
  });

  es.addEventListener('token.usage', (e) => {
    try {
      broadcast('token.usage', JSON.parse(e.data));
    } catch (err) {
      console.error('SSE Parse Error:', err);
    }
  });
}

function ensureEventSource() {
  if (typeof window === 'undefined') return null;
  if (sharedEs) return sharedEs;
  if (isDemoMode()) return null; // Demo is simulated; avoid SSE load/noise.

  const es = new EventSource('/api/stream');
  sharedEs = es;

  es.onopen = () => {
    // Connected
  };

  es.onerror = () => {
    try { es.close(); } catch {}
    sharedEs = null;

    // Lightweight reconnect if there are still active subscribers.
    if (subscribers.size > 0 && !sharedReconnectTimer) {
      sharedReconnectTimer = setTimeout(() => {
        sharedReconnectTimer = null;
        ensureEventSource();
      }, 1500);
    }
  };

  attachListeners(es);
  return es;
}

function maybeCloseEventSource() {
  if (subscribers.size > 0) return;
  if (sharedReconnectTimer) {
    clearTimeout(sharedReconnectTimer);
    sharedReconnectTimer = null;
  }
  if (sharedEs) {
    try { sharedEs.close(); } catch {}
    sharedEs = null;
  }
}

export function useRealtime(onEvent) {
  // BUG-03b: previously gated the SSE subscription on `session?.user?.id`
  // from useSession(), which always returned null for local-password admins
  // — they got no realtime updates on mission-control, decisions, etc.
  // useEffectiveRole resolves both auth paths via /api/session/effective.
  const { authenticated } = useEffectiveRole();
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!authenticated) return;

    const handler = (event, payload) => onEventRef.current?.(event, payload);
    subscribers.add(handler);
    ensureEventSource();

    return () => {
      subscribers.delete(handler);
      maybeCloseEventSource();
    };
  }, [authenticated]);
}
