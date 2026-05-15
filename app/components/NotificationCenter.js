'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useRealtime } from '../hooks/useRealtime';

export default function NotificationCenter() {
  const [notifications, setNotifications] = useState([]);
  const [permission, setPermission] = useState('default');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  // Close on Escape or outside click while the popover is open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    const onClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [isOpen]);

  const requestPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        addNotification('success', 'Notifications enabled.');
      }
    }
  };

  const addNotification = useCallback((type, message, title = 'DashClaw') => {
    const newNotif = {
      id: Date.now(),
      type,
      title,
      message,
      timestamp: new Date().toLocaleTimeString(),
      read: false
    };
    setNotifications(prev => [newNotif, ...prev].slice(0, 20));

    // Read live permission off the platform API instead of closing over the
    // React-state copy: a permission grant that lands between callback
    // memoization and an event firing would otherwise be missed.
    const currentPermission =
      typeof window !== 'undefined' && 'Notification' in window
        ? Notification.permission
        : 'denied';
    if (currentPermission === 'granted' && type !== 'info') {
      new Notification(title, { body: message });
    }
  }, []);

  // Listen to real-time SSE events for governance notifications
  useRealtime(useCallback((event, payload) => {
    // Approval required — an agent is waiting for human decision
    if (event === 'action.created') {
      const action = payload?.action || payload;
      if (action?.status === 'pending_approval') {
        const agentName = action.agent_name || action.agent_id || 'An agent';
        const goal = action.declared_goal || action.action_type || 'action';
        addNotification('warning', `${agentName} needs approval: ${goal}`, 'Approval required');
      }
    }

    // Guard blocked an action
    if (event === 'guard.decision.created') {
      const decision = payload?.decision;
      if (decision?.decision === 'block') {
        const agentName = decision.agent_id || 'An agent';
        addNotification('error', `Action blocked for ${agentName}`, 'Guard policy');
      }
    }

    // Risk signal detected
    if (event === 'signal.detected') {
      const signalType = (payload?.type || 'risk signal').replace(/_/g, ' ');
      addNotification('error', `${signalType} detected`, 'Risk signal');
    }
  }, [addNotification]));

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const clearAll = () => {
    setNotifications([]);
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const getTypeIcon = (type) => {
    switch (type) {
      case 'error': return <XCircle size={14} className="text-error" aria-hidden="true" />;
      case 'warning': return <AlertTriangle size={14} className="text-warning" aria-hidden="true" />;
      case 'success': return <CheckCircle2 size={14} className="text-success" aria-hidden="true" />;
      default: return <Info size={14} className="text-info" aria-hidden="true" />;
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label={unreadCount > 0 ? `Notifications · ${unreadCount} unread` : 'Notifications'}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="relative rounded-lg p-2 transition-colors duration-150 hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-brand/40"
      >
        <Bell size={18} className="text-secondary" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full border border-surface-primary bg-status-error px-1 text-[10px] font-semibold tabular-nums text-white"
          >
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-11 z-50 max-h-96 w-80 overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-white">Notifications</h3>
            <div className="flex items-center gap-3">
              {permission !== 'granted' && (
                <button onClick={requestPermission} className="text-xs text-brand transition-colors hover:text-brand-hover">
                  Enable
                </button>
              )}
              <button onClick={markAllRead} className="text-xs text-tertiary transition-colors hover:text-white">
                Mark read
              </button>
              <button onClick={clearAll} className="text-xs text-tertiary transition-colors hover:text-white">
                Clear
              </button>
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-tertiary">
                <Bell size={24} className="mb-2 text-disabled" aria-hidden="true" />
                <span className="text-sm">No notifications</span>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className={`px-4 py-3 transition-colors ${!notif.read ? 'bg-white/[0.02]' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="mt-0.5 shrink-0">{getTypeIcon(notif.type)}</div>
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-white">{notif.title}</div>
                          <div className="mt-0.5 text-xs text-secondary">{notif.message}</div>
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] tabular-nums text-tertiary">{notif.timestamp}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {permission !== 'granted' && (
            <div className="border-t border-border px-4 py-2.5 text-center">
              <button onClick={requestPermission} className="text-xs text-brand transition-colors hover:text-brand-hover">
                Enable browser notifications
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
