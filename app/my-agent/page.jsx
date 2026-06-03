'use client';

// /my-agent — narrative agent-activity page. CCI-04 second surface.
//
// Data flow:
//   - Fetch /api/actions?limit=200 + /api/guard?limit=200 (no new API routes per D-13).
//   - Re-fetch on mount, on useAgentFilter change, and on useRealtime events
//     (action.created / action.updated / guard.decision.created).
//
// Copy voice (.impeccable.md): direct, declarative, technical. No emoji, no
// "welcome to..." fluff. Brand orange ONLY on the CTA link and denial chip.
// Tokens only (tiebreaker #4) — no hardcoded hex.
//
// XSS discipline (T-02-03-03): untrusted strings (declared_goal, reason) are
// rendered ONLY via React text interpolation, which escapes HTML by default.
// No raw-HTML injection APIs are used anywhere in this file.

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useRealtime } from '../hooks/useRealtime';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { getAgentColor } from '../lib/colors';
import {
  Activity, Terminal, ShieldAlert, AlertTriangle, ChevronRight,
} from 'lucide-react';

const DAY_MS = 24 * 60 * 60 * 1000;

function buildNarrative(scope, counts) {
  const when = scope === 'today' ? 'Today' : 'This week';
  if (counts.total === 0) {
    return `${when}, your agent hasn't run anything yet.`;
  }
  const cmd = `command${counts.total === 1 ? '' : 's'}`;
  const parts = [`${when} your agent ran ${counts.total} ${cmd}.`];
  if (counts.requiredApproval > 0) {
    parts.push(`${counts.requiredApproval} required approval.`);
  }
  if (counts.denied > 0) {
    const verb = counts.denied === 1 ? 'was' : 'were';
    parts.push(`${counts.denied} ${verb} denied.`);
  }
  return parts.join(' ');
}

function extractPolicyName(matchedPolicies) {
  if (!Array.isArray(matchedPolicies) || matchedPolicies.length === 0) return null;
  const top = matchedPolicies[0];
  if (!top) return null;
  return top.name || top.policy_name || top.id || top.policy_id || null;
}

function formatTimestamp(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--';
  }
}

export default function MyAgentPage() {
  const { agentId } = useAgentFilter();
  const [scope, setScope] = useState('today'); // 'today' | 'week'
  const [actions, setActions] = useState([]);
  const [guardDecisions, setGuardDecisions] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const agentQs = agentId ? `&agent_id=${encodeURIComponent(agentId)}` : '';
      const [actionsRes, guardRes] = await Promise.all([
        fetch(`/api/actions?limit=200${agentQs}`),
        fetch(`/api/guard?limit=200${agentQs}`),
      ]);
      const actionsJson = await actionsRes.json();
      const guardJson = await guardRes.json();
      setActions(actionsJson.actions || []);
      setGuardDecisions(guardJson.decisions || []);
    } catch (err) {
      console.warn('[my-agent] fetch failed:', err?.message || err);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useRealtime((event) => {
    if (
      event === 'action.created' ||
      event === 'action.updated' ||
      event === 'guard.decision.created'
    ) {
      fetchData();
    }
  });

  const filtered = useMemo(() => {
    const cutoff = Date.now() - (scope === 'today' ? DAY_MS : 7 * DAY_MS);
    return {
      actions: actions.filter((a) => {
        const t = new Date(a.timestamp_start).getTime();
        return Number.isFinite(t) && t >= cutoff;
      }),
      guard: guardDecisions.filter((g) => {
        const t = new Date(g.created_at).getTime();
        return Number.isFinite(t) && t >= cutoff;
      }),
    };
  }, [scope, actions, guardDecisions]);

  const counts = useMemo(() => {
    const total = filtered.actions.length;
    const approved = filtered.actions.filter((a) => a.status === 'completed').length;
    const requiredApproval = filtered.actions.filter((a) => Boolean(a.approved_by)).length;
    const denied = filtered.guard.filter(
      (g) => g.decision === 'block' || g.decision === 'deny'
    ).length;
    return { total, approved, denied, requiredApproval };
  }, [filtered]);

  const hasAnyActivity = actions.length + guardDecisions.length > 0;

  // D-10: empty-state install-prompt hero
  if (!loading && !hasAnyActivity) {
    return <InstallPromptHero />;
  }

  const denials = filtered.guard.filter(
    (g) => g.decision === 'block' || g.decision === 'deny'
  );

  // Chronological list excludes guard decisions (they're pinned above).
  const chronological = [...filtered.actions].sort(
    (a, b) => new Date(b.timestamp_start) - new Date(a.timestamp_start)
  );

  const narrative = buildNarrative(scope, counts);
  const deniedClauseClass =
    counts.denied > 0 ? 'text-status-warning' : 'text-primary';

  return (
    <PageLayout title="My Agent" breadcrumbs={['Command', 'My Agent']}>
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Narrative hero */}
        <Card hover={false}>
          <CardContent className="py-6">
            {loading ? (
              <Skeleton className="h-8 w-full" />
            ) : (
              <p className={`text-xl font-semibold leading-snug ${deniedClauseClass}`}>
                {narrative}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Today / Week toggle — D-09 */}
        <div className="flex items-center gap-2" role="group" aria-label="Scope">
          <button
            type="button"
            onClick={() => setScope('today')}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              scope === 'today'
                ? 'border-active bg-white/5 text-primary'
                : 'border-border text-secondary hover:border-border-hover'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setScope('week')}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              scope === 'week'
                ? 'border-active bg-white/5 text-primary'
                : 'border-border text-secondary hover:border-border-hover'
            }`}
          >
            This week
          </button>
        </div>

        {/* Pinned denials — D-11 */}
        {denials.length > 0 && (
          <section data-testid="denials-section">
            <header className="mb-2 flex items-center gap-2">
              <ShieldAlert size={14} className="text-status-warning" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-status-warning">
                Denied actions
              </span>
            </header>
            <Card hover={false}>
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {denials.map((d) => {
                    const policy = extractPolicyName(d.matched_policies);
                    return (
                      <li key={d.id} className="flex items-start gap-3 p-4">
                        <AlertTriangle
                          size={14}
                          className="mt-1 shrink-0 text-status-warning"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${getAgentColor(d.agent_id)}`}
                            >
                              {d.agent_id || 'unknown'}
                            </span>
                            {policy && (
                              <span className="rounded-full border border-border bg-surface-tertiary px-2 py-0.5 font-mono text-[10px] text-secondary">
                                {policy}
                              </span>
                            )}
                            <span className="font-mono text-[10px] tabular-nums text-tertiary">
                              {formatTimestamp(d.created_at)}
                            </span>
                          </div>
                          <p className="text-sm text-secondary">{d.reason}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          </section>
        )}

        {/* Chronological action list */}
        <section data-testid="chrono-section">
          <header className="mb-2 flex items-center gap-2">
            <Activity size={14} className="text-tertiary" aria-hidden="true" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
              Commands
            </span>
          </header>
          <Card hover={false}>
            <CardContent className="p-0">
              {chronological.length === 0 ? (
                <EmptyState
                  icon={Terminal}
                  title="No commands in this window"
                  description={scope === 'today' ? 'Switch to This week for a broader view.' : 'No activity in the last 7 days.'}
                />
              ) : (
                <ul className="divide-y divide-border">
                  {chronological.slice(0, 50).map((a) => (
                    <li key={a.action_id} className="flex items-start gap-3 p-4">
                      <span className="font-mono text-[10px] tabular-nums text-tertiary pt-1 min-w-[40px]">
                        {formatTimestamp(a.timestamp_start)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${getAgentColor(a.agent_id)}`}
                          >
                            {a.agent_id || 'unknown'}
                          </span>
                          <span className="rounded-full border border-border bg-surface-tertiary px-2 py-0.5 font-mono text-[10px] text-secondary">
                            {a.action_type}
                          </span>
                          {a.approved_by && (
                            <span className="rounded-full border border-active/30 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                              approved
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-secondary line-clamp-2">
                          {a.declared_goal}
                        </p>
                      </div>
                      <ChevronRight
                        size={14}
                        className="mt-1 shrink-0 text-tertiary"
                        aria-hidden="true"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </PageLayout>
  );
}

function InstallPromptHero() {
  return (
    <PageLayout title="My Agent" breadcrumbs={['Command', 'My Agent']}>
      <div className="mx-auto max-w-2xl">
        <Card hover={false}>
          <CardContent className="py-10 text-center">
            <Terminal
              size={28}
              className="mx-auto mb-4 text-tertiary"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <h2 className="text-xl font-semibold text-primary">
              Your agent hasn&apos;t run anything yet.
            </h2>
            <p className="mt-2 text-sm text-secondary">
              Three steps to get a coding agent governed, with Discord approvals
              on your phone. Works with Claude Code, Codex, and Hermes Agent.
            </p>
            <ol className="mx-auto mt-6 max-w-md space-y-2 text-left text-sm text-secondary">
              <li className="flex items-start gap-3">
                <span className="font-mono text-tertiary tabular-nums">1.</span>
                <span>
                  Install the hook{' '}
                  <code className="font-mono text-xs text-primary">npm run hooks:install</code>{' '}
                  (or{' '}
                  <code className="font-mono text-xs text-primary">dashclaw install codex</code>{' '}
                  /{' '}
                  <code className="font-mono text-xs text-primary">bash scripts/install-hermes-plugin.sh</code>)
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="font-mono text-tertiary tabular-nums">2.</span>
                <span>Connect Discord (bot token + approver user ID)</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="font-mono text-tertiary tabular-nums">3.</span>
                <span>Trigger a tool call from your agent</span>
              </li>
            </ol>
            <Link
              href="/guides/claude-code"
              className="mt-6 inline-flex items-center gap-1 rounded-md border border-active/30 bg-brand/10 px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand/20"
            >
              Open the full guide
              <ChevronRight size={14} aria-hidden="true" />
            </Link>
            <div className="mt-3 text-xs text-tertiary">
              <Link href="/guides/codex" className="underline decoration-border hover:decoration-secondary">
                Codex
              </Link>
              {' · '}
              <Link href="/guides/hermes" className="underline decoration-border hover:decoration-secondary">
                Hermes Agent
              </Link>
              {' · '}
              <Link href="/connect" className="underline decoration-border hover:decoration-secondary">
                all guides
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
