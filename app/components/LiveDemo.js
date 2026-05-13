'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Play,
  Check,
  X,
  ShieldAlert,
  ShieldCheck,
  Clock,
  ArrowRight,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { trackMarketingEvent } from '../lib/marketingTrack';

/*
 * Live, interactive governance demo for the marketing home page.
 *
 * Wires real /api/guard POST requests against the dashclaw.io demo deployment
 * (DASHCLAW_MODE=demo). The three presets target deterministic demo agents in
 * app/lib/demo/demoMiddleware.js so each yields a distinct decision shape:
 *
 *   - analytics-agent  (risk 25)       -> decision: allow
 *   - openai-deployer-1                -> decision: require_approval
 *                                         action_id is the persisted demo
 *                                         action ar_demo_deploy_block_001, so
 *                                         /replay/<id> resolves cleanly.
 *   - rogue-agent      (risk 92)       -> decision: block
 *
 * The Allow / Deny buttons on a require_approval result resolve in local
 * state only. The /api/actions/:id/approve endpoint is not wired into demo
 * middleware and we are constrained not to edit middleware.js. The honest
 * trade-off is documented in the helper text under the Approval card.
 */

const PRESETS = [
  {
    id: 'allow',
    label: 'Sync user metrics',
    agentId: 'analytics-agent',
    actionType: 'sync_metrics',
    riskScore: 25,
    declaredGoal: 'Sync hourly product metrics from the warehouse to the analytics dashboard.',
  },
  {
    id: 'review',
    label: 'Deploy to production',
    agentId: 'openai-deployer-1',
    actionType: 'deploy',
    riskScore: 85,
    declaredGoal: 'Deploy auth-service v2.1 to production with new session token rotation.',
  },
  {
    id: 'block',
    label: 'Drop production users table',
    agentId: 'rogue-agent',
    actionType: 'delete_database',
    riskScore: 92,
    declaredGoal: 'Drop the production users table to free storage on the primary cluster.',
  },
];

const PHASE = {
  IDLE: 'idle',
  EVALUATING: 'evaluating',
  DECIDED: 'decided',
  RESOLVED: 'resolved',
};

function parseMatchedPolicies(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [value];
    } catch {
      return [value];
    }
  }
  return [];
}

function replayHrefFor(actionId) {
  // The persisted demo action id replays cleanly. Random ar_demo_* ids minted
  // by demoGuardPost are not persisted, so for those we link visitors to /demo
  // which seeds the cookie and lands them on mission control.
  if (actionId === 'ar_demo_deploy_block_001') {
    return `/replay/${actionId}`;
  }
  return '/demo';
}

export default function LiveDemo() {
  const [preset, setPreset] = useState(PRESETS[1]);
  const [goal, setGoal] = useState(PRESETS[1].declaredGoal);
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [decision, setDecision] = useState(null);
  const [resolution, setResolution] = useState(null);
  const [error, setError] = useState(null);

  const codePreview = useMemo(() => {
    const safeGoal = goal.replace(/`/g, '\\`').replace(/\n/g, ' ');
    return `await claw.guard({
  agent_id: '${preset.agentId}',
  action_type: '${preset.actionType}',
  risk_score: ${preset.riskScore},
  declared_goal: '${safeGoal}',
});`;
  }, [preset, goal]);

  function selectPreset(next) {
    setPreset(next);
    setGoal(next.declaredGoal);
    setPhase(PHASE.IDLE);
    setDecision(null);
    setResolution(null);
    setError(null);
  }

  async function handleEvaluate() {
    setPhase(PHASE.EVALUATING);
    setError(null);
    setResolution(null);
    setDecision(null);

    try {
      const res = await fetch('/api/guard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: preset.agentId,
          action_type: preset.actionType,
          risk_score: preset.riskScore,
          declared_goal: goal,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Guard call failed with status ${res.status}`);
      }
      setDecision(data);
      setPhase(PHASE.DECIDED);
      trackMarketingEvent('marketing_demo_evaluated', {
        preset: preset.id,
        decision: data?.decision || 'unknown',
      });
    } catch (err) {
      setError(err.message || 'Guard call failed.');
      setPhase(PHASE.IDLE);
    }
  }

  function handleResolve(value) {
    setResolution(value);
    setPhase(PHASE.RESOLVED);
  }

  function handleReset() {
    setPhase(PHASE.IDLE);
    setDecision(null);
    setResolution(null);
    setError(null);
  }

  const isEvaluating = phase === PHASE.EVALUATING;
  const isBusy = isEvaluating;

  return (
    <section
      id="live-demo"
      aria-labelledby="live-demo-heading"
      className="py-20 px-6 border-t border-border bg-surface-secondary/40 scroll-mt-20"
    >
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-text-tertiary mb-3">
            Live demo, real demo endpoints
          </p>
          <h2
            id="live-demo-heading"
            className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary"
          >
            Try a real governance decision
          </h2>
          <p className="mt-3 text-sm text-text-secondary max-w-2xl mx-auto leading-relaxed">
            Pick an action, hit Evaluate, and watch DashClaw enforce policy in real time. Every call hits the same governance runtime that ships to your instance.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface-secondary overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_90px_rgba(0,0,0,0.55)]">
          {/* Preset row */}
          <div className="px-5 py-4 border-b border-border bg-surface-tertiary">
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary mb-3">
              Pick an action to evaluate
            </div>
            <div
              role="radiogroup"
              aria-label="Preset actions"
              className="flex flex-wrap gap-2"
            >
              {PRESETS.map((p) => {
                const active = preset.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => selectPreset(p)}
                    className={[
                      'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      'focus:outline-none focus:ring-2 focus:ring-brand/60 focus:ring-offset-2 focus:ring-offset-surface-tertiary',
                      active
                        ? 'bg-brand-subtle text-brand border border-border-active'
                        : 'bg-surface-secondary text-text-secondary border border-border hover:border-border-hover hover:text-text-primary',
                    ].join(' ')}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Body: two column */}
          <div className="grid grid-cols-1 lg:grid-cols-2">
            {/* Left: editable call */}
            <div className="p-5 border-b lg:border-b-0 lg:border-r border-border">
              <label
                htmlFor="live-demo-goal"
                className="block text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary mb-2"
              >
                Declared goal
              </label>
              <textarea
                id="live-demo-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={3}
                className="w-full text-sm font-mono text-text-primary bg-surface-primary border border-border rounded-lg px-3 py-2 leading-relaxed resize-none focus:outline-none focus:border-border-active focus:ring-2 focus:ring-brand/30"
                disabled={isBusy}
              />

              <div className="mt-4">
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary mb-2">
                  SDK call
                </div>
                <pre className="text-xs leading-relaxed font-mono text-text-secondary bg-surface-primary border border-border rounded-lg p-3 overflow-x-auto">
                  <code>{codePreview}</code>
                </pre>
              </div>

              <button
                type="button"
                onClick={handleEvaluate}
                disabled={isBusy}
                className={[
                  'mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all',
                  'focus:outline-none focus:ring-2 focus:ring-brand/60 focus:ring-offset-2 focus:ring-offset-surface-secondary',
                  isBusy
                    ? 'bg-brand/60 text-white cursor-not-allowed'
                    : 'bg-brand text-white hover:bg-brand-hover hover:scale-[1.02] shadow-lg shadow-brand/20',
                ].join(' ')}
              >
                {isEvaluating ? (
                  <>
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    Evaluating
                  </>
                ) : (
                  <>
                    <Play size={16} aria-hidden="true" />
                    Evaluate
                  </>
                )}
              </button>

              {error ? (
                <p
                  role="alert"
                  className="mt-3 text-xs text-status-error"
                >
                  {error}
                </p>
              ) : null}
            </div>

            {/* Right: result */}
            <div className="p-5 bg-surface-secondary/40">
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary mb-3">
                Governance result
              </div>

              {phase === PHASE.IDLE && !decision ? (
                <IdlePanel />
              ) : null}

              {phase === PHASE.EVALUATING ? (
                <EvaluatingPanel />
              ) : null}

              {phase === PHASE.DECIDED && decision ? (
                <DecisionPanel
                  decision={decision}
                  onResolve={handleResolve}
                  onReset={handleReset}
                />
              ) : null}

              {phase === PHASE.RESOLVED && decision ? (
                <ResolvedPanel
                  decision={decision}
                  resolution={resolution}
                  onReset={handleReset}
                />
              ) : null}
            </div>
          </div>
        </div>

        <p className="mt-4 text-[11px] text-text-tertiary text-center max-w-2xl mx-auto leading-relaxed">
          Guard decisions are live against the demo deployment. Approval clicks resolve locally so visitors can explore the flow without an account; your own instance routes them to <code className="font-mono text-text-secondary">/api/actions/:id/approve</code>.
        </p>
      </div>
    </section>
  );
}

function IdlePanel() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-primary/40 p-5 text-sm text-text-tertiary">
      <div className="flex items-start gap-3">
        <Sparkles size={16} className="text-text-tertiary mt-0.5 shrink-0" aria-hidden="true" />
        <p className="leading-relaxed">
          Pick an action and click Evaluate. The result will appear here, including the matched policy, the risk score, and what a human approver would see.
        </p>
      </div>
    </div>
  );
}

function EvaluatingPanel() {
  return (
    <div className="rounded-xl border border-border bg-surface-primary/40 p-5 text-sm text-text-secondary">
      <div className="flex items-center gap-3">
        <Loader2 size={16} className="text-brand animate-spin" aria-hidden="true" />
        <span>Asking the governance runtime...</span>
      </div>
    </div>
  );
}

function DecisionBadge({ decision }) {
  if (decision === 'allow') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-status-success-subtle text-status-success border border-status-success/30">
        <ShieldCheck size={12} aria-hidden="true" /> Allow
      </span>
    );
  }
  if (decision === 'block') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-status-error-subtle text-status-error border border-status-error/30">
        <ShieldAlert size={12} aria-hidden="true" /> Block
      </span>
    );
  }
  if (decision === 'require_approval') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-brand-subtle text-brand border border-border-active">
        <Clock size={12} aria-hidden="true" /> Require approval
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-surface-tertiary text-text-secondary border border-border">
      {decision || 'unknown'}
    </span>
  );
}

function DecisionPanel({ decision, onResolve, onReset }) {
  const policies = parseMatchedPolicies(decision.matched_policies);
  const requiresApproval = decision.decision === 'require_approval';
  const isAllow = decision.decision === 'allow';
  const isBlock = decision.decision === 'block';

  return (
    <div className="rounded-xl border border-border bg-surface-primary/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <DecisionBadge decision={decision.decision} />
        <span className="text-[11px] font-mono text-text-tertiary">
          risk {decision.risk_score ?? '-'}
        </span>
      </div>
      <div className="px-4 py-4 space-y-3">
        {decision.reason ? (
          <p className="text-sm text-text-secondary leading-relaxed">{decision.reason}</p>
        ) : null}

        {policies.length ? (
          <div className="text-xs">
            <span className="text-text-tertiary uppercase tracking-wider font-mono">Matched policies </span>
            <span className="ml-1 inline-flex flex-wrap gap-1.5 align-middle">
              {policies.map((p) => (
                <span
                  key={p}
                  className="px-2 py-0.5 rounded bg-surface-tertiary border border-border text-text-secondary font-mono"
                >
                  {p}
                </span>
              ))}
            </span>
          </div>
        ) : null}

        {requiresApproval ? (
          <div className="mt-2 rounded-lg border border-border-active bg-brand-subtle/60 p-3">
            <p className="text-xs text-text-secondary mb-3 leading-relaxed">
              A human approver decides what happens next. In production this routes to your dashboard, CLI, mobile PWA, or Telegram bot.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => onResolve('allow')}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-bold bg-status-success text-white hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-status-success/60 focus:ring-offset-2 focus:ring-offset-surface-secondary"
              >
                <Check size={14} aria-hidden="true" /> Approve
              </button>
              <button
                type="button"
                onClick={() => onResolve('deny')}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-bold bg-status-error text-white hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-status-error/60 focus:ring-offset-2 focus:ring-offset-surface-secondary"
              >
                <X size={14} aria-hidden="true" /> Deny
              </button>
            </div>
          </div>
        ) : null}

        {(isAllow || isBlock) && decision.action_id ? (
          <div className="pt-2 flex items-center justify-between gap-3 text-xs">
            <Link
              href={replayHrefFor(decision.action_id)}
              className="inline-flex items-center gap-1.5 text-brand hover:text-brand-hover transition-colors font-medium"
            >
              View this decision <ArrowRight size={12} aria-hidden="true" />
            </Link>
            <button
              type="button"
              onClick={onReset}
              className="text-text-tertiary hover:text-text-primary transition-colors font-mono"
            >
              Reset
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ResolvedPanel({ decision, resolution, onReset }) {
  const approved = resolution === 'allow';
  return (
    <div className="rounded-xl border border-border bg-surface-primary/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span
          className={[
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider border',
            approved
              ? 'bg-status-success-subtle text-status-success border-status-success/30'
              : 'bg-status-error-subtle text-status-error border-status-error/30',
          ].join(' ')}
        >
          {approved ? <Check size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
          {approved ? 'Approved by you' : 'Denied by you'}
        </span>
        <span className="text-[11px] font-mono text-text-tertiary">
          risk {decision.risk_score ?? '-'}
        </span>
      </div>
      <div className="px-4 py-4 space-y-3 text-sm text-text-secondary leading-relaxed">
        <p>
          {approved
            ? 'Your approval would unblock the agent within about a second. The action carries the approver identity and the resolution reason into the audit trail.'
            : 'The agent receives a denial event, throws ApprovalDeniedError, and never touches the real system. The denial reason lands in the audit trail next to the original guard decision.'}
        </p>
        <div className="pt-1 flex items-center justify-between gap-3 text-xs">
          <Link
            href={replayHrefFor(decision.action_id)}
            className="inline-flex items-center gap-1.5 text-brand hover:text-brand-hover transition-colors font-medium"
          >
            View this decision <ArrowRight size={12} aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={onReset}
            className="text-text-tertiary hover:text-text-primary transition-colors font-mono"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
