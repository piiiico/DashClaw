'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2, SkipForward, RotateCcw, Copy, Check } from 'lucide-react';

interface CopyButtonProps {
  text: string;
  label?: string;
}

function CopyButton({ text, label = 'Copy' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex items-center gap-1.5 rounded border border-border bg-surface-tertiary px-2 py-1 text-[10px] font-medium text-tertiary transition-colors hover:text-secondary hover:border-border-hover"
    >
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

// Pull top-level scalar fields into a one-line labeled summary so a human can
// scan the step without reading the raw JSON dump below.
function scalarFields(value: any): [string, string][] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value)
    .filter(([, v]) => v != null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
    .map(([k, v]) => [k, String(v)] as [string, string]);
}

function FieldSummary({ value }: { value: any }) {
  const fields = scalarFields(value);
  if (fields.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
      {fields.map(([k, v]) => (
        <span key={k} className="text-[11px] text-secondary">
          <span className="text-tertiary">{k}:</span>{' '}
          <span className="font-mono break-all">{v.length > 80 ? `${v.slice(0, 80)}…` : v}</span>
        </span>
      ))}
    </div>
  );
}

const STATUS_CONFIG: Record<string, { icon: any; color: string; bg: string }> = {
  completed: { icon: CheckCircle2, color: 'text-success', bg: 'bg-emerald-400/10' },
  failed: { icon: XCircle, color: 'text-error', bg: 'bg-red-400/10' },
  running: { icon: Loader2, color: 'text-info', bg: 'bg-blue-400/10' },
  skipped: { icon: SkipForward, color: 'text-tertiary', bg: 'bg-zinc-500/10' },
  pending: { icon: Loader2, color: 'text-tertiary', bg: 'bg-zinc-500/10' },
  reused: { icon: RotateCcw, color: 'text-secondary', bg: 'bg-zinc-400/5' },
};

const TYPE_LABELS: Record<string, string> = {
  knowledge_search: 'Knowledge',
  capability_invoke: 'Capability',
  prompt: 'Prompt',
};

interface WorkflowRunStepCardProps {
  step: any;
  runStatus: string;
  onResumeFromStep?: (stepId: string) => void;
}

export default function WorkflowRunStepCard({ step, runStatus, onResumeFromStep }: WorkflowRunStepCardProps) {
  const [expanded, setExpanded] = useState(step.status === 'failed');
  const config = STATUS_CONFIG[step.status] || STATUS_CONFIG.pending!;
  const Icon = config.icon;
  const canResume =
    runStatus === 'failed' &&
    step.status !== 'completed' &&
    Boolean(step.step_id) &&
    typeof onResumeFromStep === 'function';

  return (
    <div className={`rounded-lg border border-border ${config.bg}`}>
      <div className="flex items-center">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex flex-1 items-center gap-3 px-4 py-3 text-left"
        >
          <Icon className={`w-4 h-4 ${config.color} flex-shrink-0`} />
          <span className="font-medium text-sm text-secondary flex-1">{step.step_name}</span>
          <span className="text-[10px] font-mono text-tertiary uppercase">{TYPE_LABELS[step.step_type] || step.step_type}</span>
          {step.retry_count > 0 && (
            <span className="text-[10px] font-mono text-warning">{step.retry_count + 1} attempts</span>
          )}
          {step.duration_ms != null && (
            <span className="text-xs font-mono text-tertiary">{(step.duration_ms / 1000).toFixed(1)}s</span>
          )}
          {expanded ? <ChevronDown className="w-3 h-3 text-tertiary" /> : <ChevronRight className="w-3 h-3 text-tertiary" />}
        </button>
        {canResume && (
          <button
            onClick={() => onResumeFromStep?.(step.step_id)}
            title="Resume from this step and reuse prior completed steps"
            className="mr-2 flex items-center gap-1 rounded-lg border border-brand/20 bg-brand/10 px-2.5 py-1 text-[11px] font-medium text-brand transition-colors hover:bg-brand/20"
          >
            <RotateCcw className="w-3 h-3" /> Resume from here
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border">
          {step.error_message && (
            <div className="mt-3 p-2 rounded bg-red-400/10 text-error text-xs font-mono">{step.error_message}</div>
          )}
          {step.input && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-mono text-tertiary uppercase">Input</span>
                <CopyButton text={JSON.stringify(step.input, null, 2)} />
              </div>
              <FieldSummary value={step.input} />
              <pre className="text-xs text-secondary bg-black/30 rounded p-2 overflow-auto max-h-48">{JSON.stringify(step.input, null, 2)}</pre>
            </div>
          )}
          {step.output && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-mono text-tertiary uppercase">Output</span>
                <CopyButton text={JSON.stringify(step.output, null, 2)} />
              </div>
              <FieldSummary value={step.output} />
              <pre className="text-xs text-secondary bg-black/30 rounded p-2 overflow-auto max-h-48">{JSON.stringify(step.output, null, 2)}</pre>
            </div>
          )}
          {!step.input && !step.output && !step.error_message && (
            <div className="mt-3 text-xs text-disabled">No data recorded</div>
          )}
        </div>
      )}
    </div>
  );
}
