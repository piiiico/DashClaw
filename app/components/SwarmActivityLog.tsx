'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Zap, MessageSquare, Shield, Activity, Eye, EyeOff,
  Terminal, Target, AlertTriangle, XCircle,
} from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useRealtime } from '../hooks/useRealtime';
import { getAgentColor } from '../lib/colors';
import {
  buildActionEvent,
  buildGuardEvent,
  buildLoopEvent,
  collapseRoutineTelemetry,
  isPriorityEvent,
  OPERATOR_CHANNEL_OPTIONS,
} from '../lib/missionControl';

function formatTime(ts: any) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const RAW_PATTERN_LABELS: [RegExp, string | ((text: string) => string)][] = [
  [/^Warned:\s*other$/i, 'Guard raised warning'],
  [/^Warned:\s*/i, (text) => `Guard warning: ${text.replace(/^Warned:\s*/i, '')}`],
  [/^Blocked:\s*other$/i, 'Blocked by policy'],
  [/^Blocked:\s*/i, (text) => `Policy block: ${text.replace(/^Blocked:\s*/i, '')}`],
  [/^Failed:\s*other$/i, 'Action failed'],
  [/^Failed:\s*/i, (text) => `Failed: ${text.replace(/^Failed:\s*/i, '')}`],
  [/^Allowed:\s*other$/i, 'Guard cleared action'],
];

function humanizeLogText(text: any) {
  if (!text) return '';
  for (const [pattern, replacement] of RAW_PATTERN_LABELS) {
    if (pattern.test(text)) {
      return typeof replacement === 'function' ? replacement(text) : replacement;
    }
  }
  return text;
}

function toLogEntry(item: any): any {
  if (item.kind === 'message') return item;

  const source = item.category === 'governance'
    ? 'guard'
    : item.category === 'intervention'
      ? 'loop'
      : item.category === 'telemetry'
        ? 'telemetry'
        : 'action';

  return {
    id: item.id,
    kind: source,
    category: item.category || (source === 'loop' ? 'intervention' : source === 'guard' ? 'governance' : source === 'telemetry' ? 'telemetry' : 'decision'),
    agentId: item.agentId,
    text:
      source === 'guard'
        ? `${item.statusLabel}: ${item.outputSummary || item.actionType || item.title}`
        : source === 'loop'
          ? `${item.title}${item.goal ? ` -> ${item.goal}` : ''}`
          : `${item.title}${item.outputSummary ? ` -> ${item.outputSummary}` : ''}`,
    timestamp: item.timestamp,
    lowSignal: item.lowSignal,
    count: item.count || 1,
    status: item.status,
  };
}

interface SwarmActivityLogProps {
  activeCategory?: string;
  onCategoryChange?: ((id: any) => void) | null;
  showTelemetry?: boolean;
  onToggleTelemetry?: (() => void) | null;
}

export default function SwarmActivityLog({
  activeCategory = 'all',
  onCategoryChange = null,
  showTelemetry = false,
  onToggleTelemetry = null,
}: SwarmActivityLogProps) {
  const { agentId } = useAgentFilter();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchInitial() {
      try {
        const agentParam = agentId ? `agent_id=${encodeURIComponent(agentId)}` : '';
        const withPrefix = (base: string, extra: string[] = []) => {
          const params = [...extra];
          if (agentParam) params.push(agentParam);
          return `${base}${params.length ? `?${params.join('&')}` : ''}`;
        };

        const [actionsRes, guardRes, loopsRes] = await Promise.all([
          fetch(withPrefix('/api/actions', ['limit=12'])),
          fetch(withPrefix('/api/guard', ['limit=10'])),
          fetch(withPrefix('/api/actions/loops', ['limit=8'])),
        ]);

        const merged: any[] = [];

        if (actionsRes.ok) {
          const d = await actionsRes.json();
          merged.push(...(d.actions || []).map(buildActionEvent).map(toLogEntry));
        }

        if (guardRes.ok) {
          const d = await guardRes.json();
          merged.push(...(d.decisions || []).map(buildGuardEvent).map(toLogEntry));
        }

        if (loopsRes.ok) {
          const d = await loopsRes.json();
          merged.push(...(d.loops || []).map(buildLoopEvent).map(toLogEntry));
        }

        const collapsed = collapseRoutineTelemetry(
          merged.map((item) => item.kind === 'message' ? { ...item, emphasis: 48 } : item)
        ).map((item: any) => item.kind ? item : toLogEntry(item));

        setLogs(collapsed.slice(0, 50));
      } catch (err) {
        console.error('Failed to fetch activity logs:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchInitial();
  }, [agentId]);

  useRealtime(useCallback((event: any, payload: any) => {
    let newEntry: any = null;

    if (event === 'action.created' || event === 'action.updated') {
      const action = payload.action || payload;
      if (agentId && action.agent_id !== agentId) return;
      newEntry = toLogEntry(buildActionEvent(action));
    } else if (event === 'message.created') {
      const msg = payload.message || payload;
      if (agentId && msg.from_agent_id !== agentId && msg.to_agent_id !== agentId) return;
        newEntry = {
          id: `message:${msg.id}`,
          kind: 'message',
          category: 'decision',
          agentId: msg.from_agent_id,
          text: `Message: ${msg.subject || msg.body?.substring(0, 48) || 'No subject'}`,
          timestamp: msg.created_at,
        lowSignal: false,
        status: null,
      };
    } else if (event === 'guard.decision.created') {
      const guard = payload.guardDecision || payload.decision || payload;
      if (agentId && guard.agent_id !== agentId) return;
      newEntry = toLogEntry(buildGuardEvent(guard));
    } else if (event === 'loop.created' || event === 'loop.updated') {
      const loop = payload.loop || payload;
      if (agentId && loop.agent_id !== agentId) return;
      newEntry = toLogEntry(buildLoopEvent(loop));
    } else if (event === 'goal.created' || event === 'goal.updated') {
      const goal = payload.goal || payload;
      if (agentId && goal.agent_id !== agentId) return;
      newEntry = {
        id: `goal:${goal.id}`,
        kind: 'goal',
        category: 'decision',
        agentId: goal.agent_id,
        text: `${event === 'goal.created' ? 'Goal opened' : 'Goal updated'}: ${goal.title}${goal.progress != null ? ` (${goal.progress}%)` : ''}`,
        timestamp: goal.created_at || new Date().toISOString(),
        lowSignal: false,
        status: goal.status,
      };
    }

    if (!newEntry) return;

    setLogs((prev) => {
      const merged = [newEntry, ...prev.filter((item) => item.id !== newEntry.id)].slice(0, 60);
      const collapsed = collapseRoutineTelemetry(
        merged.map((item) => item.kind === 'message' || item.kind === 'goal'
          ? { ...item, emphasis: 42 }
          : item)
      ).map((item: any) => item.kind ? item : toLogEntry(item));

      return collapsed.slice(0, 50);
    });
  }, [agentId]));

  const setCategory = onCategoryChange || (() => {});
  const toggleTelemetry = onToggleTelemetry || (() => {});
  const baseLogs = showTelemetry ? logs : logs.filter((log) => !log.lowSignal);
  const visibleLogs = activeCategory === 'priority'
    ? baseLogs.filter(isPriorityEvent)
    : activeCategory === 'all'
      ? baseLogs
      : baseLogs.filter((log) => log.category === activeCategory);
  const telemetryCount = logs.filter((log) => log.lowSignal).reduce((sum, log) => sum + (log.count || 1), 0);
  const hasAnyLogs = logs.length > 0;

  return (
    <Card className="h-full flex flex-col overflow-hidden border-brand/10">
      <CardHeader title="Mission Feed" icon={Terminal} className="bg-brand/5">
        <div className="flex items-center gap-2">
          <Badge variant="brand" size="xs">Live</Badge>
          {telemetryCount > 0 && (
            <button
              type="button"
              onClick={toggleTelemetry}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-wider text-secondary transition-colors hover:text-white"
            >
              {showTelemetry ? <EyeOff size={11} /> : <Eye size={11} />}
              {showTelemetry ? 'Hide telemetry' : `Show ${telemetryCount} telemetry`}
            </button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden bg-black/40 p-0 font-mono text-[11px]">
        <div className="h-full overflow-y-auto p-3 space-y-1.5 scrollbar-thin scrollbar-thumb-zinc-800">
          <div className="mb-2 flex flex-wrap gap-2 border-b border-white/[0.04] pb-2 font-sans">
            {OPERATOR_CHANNEL_OPTIONS.map((option: any) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setCategory(option.id)}
                className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                  activeCategory === option.id
                    ? 'border-brand/40 bg-brand/10 text-brand'
                    : 'border-white/10 text-tertiary hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex h-full items-center justify-center text-disabled animate-pulse">
              Initialising stream...
            </div>
          ) : visibleLogs.length === 0 ? (
            <EmptyState
              icon={Activity}
              title={hasAnyLogs && activeCategory !== 'all' ? `No ${activeCategory} events in the live feed` : 'Awaiting governed activity'}
              description={
                hasAnyLogs && activeCategory !== 'all'
                  ? 'This operator lens is empty right now. Switch categories or reveal telemetry to inspect lower-signal updates.'
                  : 'Policy interventions, active work, and meaningful outcomes will stream here first. Routine telemetry stays out of the way.'
              }
            />
          ) : (
            visibleLogs.map((log) => {
              const agentColor = getAgentColor(log.agentId);
              const Icon =
                log.kind === 'action' ? Zap :
                log.kind === 'message' ? MessageSquare :
                log.kind === 'goal' ? Target :
                log.kind === 'guard' ? Shield :
                log.kind === 'loop' ? AlertTriangle :
                Activity;
              const typeColor =
                log.kind === 'action' ? 'text-sky-400' :
                log.kind === 'message' ? 'text-purple-400' :
                log.kind === 'goal' ? 'text-success' :
                log.kind === 'guard' ? (log.status === 'block' ? 'text-error' : 'text-warning') :
                log.kind === 'loop' ? 'text-warning' :
                'text-tertiary';

              return (
                <div key={log.id} className={`group flex items-center gap-2 border-b py-1.5 last:border-0 ${log.lowSignal ? 'border-white/[0.015]' : 'border-white/[0.03]'}`}>
                  <span className="w-[72px] shrink-0 tabular-nums text-disabled">[{formatTime(log.timestamp)}]</span>
                  <div className={`shrink-0 ${typeColor}`}>
                    <Icon size={10} />
                  </div>
                  <span className={`max-w-[80px] shrink-0 truncate rounded border border-white/6 bg-white/[0.03] px-1 text-[10px] ${agentColor}`}>
                    {log.agentId?.substring(0, 8) || 'system'}
                  </span>
                  <span className={`min-w-0 flex-1 truncate transition-colors ${log.lowSignal ? 'text-tertiary group-hover:text-secondary' : 'text-secondary group-hover:text-white'}`}>
                    {humanizeLogText(log.text)}
                  </span>
                  {log.count > 1 && (
                    <Badge variant="default" size="xs">{log.count}x</Badge>
                  )}
                  {log.kind === 'guard' && log.status === 'block' && (
                    <XCircle size={10} className="shrink-0 text-error" />
                  )}
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
