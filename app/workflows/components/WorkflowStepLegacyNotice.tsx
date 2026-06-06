'use client';

import { AlertTriangle } from 'lucide-react';

interface WorkflowStepLegacyFallback {
  nodeCount: number;
  edgeCount: number;
  nodeTypes: string[];
  previewSteps: string[];
}

interface WorkflowStepLegacyNoticeProps {
  legacyFallback?: WorkflowStepLegacyFallback | null;
}

export default function WorkflowStepLegacyNotice({ legacyFallback }: WorkflowStepLegacyNoticeProps) {
  if (!legacyFallback) return null;

  const { nodeCount, edgeCount, nodeTypes, previewSteps } = legacyFallback;

  return (
    <div className="rounded-xl border border-warning/20 bg-warning-subtle p-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-warning-subtle p-2 text-warning">
          <AlertTriangle size={16} />
        </div>
        <div>
          <div className="text-sm font-medium text-amber-200">This workflow was saved with the legacy graph editor</div>
          <p className="mt-1 text-sm text-amber-100/80">
            DashClaw now runs workflows as ordered executable steps. This older graph data is shown read-only so you can inspect it honestly instead of editing it through a misleading canvas.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-xs uppercase tracking-wider text-tertiary">Nodes</div>
          <div className="mt-1 text-sm font-medium text-white">{nodeCount} node{nodeCount === 1 ? '' : 's'}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-xs uppercase tracking-wider text-tertiary">Edges</div>
          <div className="mt-1 text-sm font-medium text-white">{edgeCount} edge{edgeCount === 1 ? '' : 's'}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-xs uppercase tracking-wider text-tertiary">Node types</div>
          <div className="mt-1 text-sm font-medium text-white">{nodeTypes.length > 0 ? nodeTypes.join(', ') : 'Unknown'}</div>
        </div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-tertiary">Preview</div>
        {previewSteps.length === 0 ? (
          <p className="mt-2 text-sm text-secondary">No readable legacy nodes were found in this workflow definition.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {previewSteps.map((previewStep) => (
              <li key={previewStep} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-secondary">
                {previewStep}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
