'use client';

import { useState, useEffect } from 'react';
import { FileJson, Package, ChevronDown, ChevronRight } from 'lucide-react';

const TYPE_PILL = {
  json: 'bg-blue-400/10 text-info border-blue-400/20',
  evidence_bundle: 'bg-purple-400/10 text-purple-400 border-purple-400/20',
  report: 'bg-emerald-400/10 text-success border-success/20',
  file: 'bg-zinc-400/10 text-secondary border-zinc-400/20',
  transcript: 'bg-amber-400/10 text-warning border-warning/20',
  patch: 'bg-orange-400/10 text-brand border-active/20',
};

function ArtifactRow({ artifact }) {
  const [expanded, setExpanded] = useState(false);
  const pill = TYPE_PILL[artifact.artifact_type] || TYPE_PILL.file;

  return (
    <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <FileJson className="w-4 h-4 text-tertiary flex-shrink-0" />
        <span className="text-sm text-secondary flex-1">{artifact.name}</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${pill}`}>
          {artifact.artifact_type}
        </span>
        <span className="text-[10px] text-disabled">
          {artifact.created_at ? new Date(artifact.created_at).toLocaleString() : ''}
        </span>
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-tertiary" />
        ) : (
          <ChevronRight className="w-3 h-3 text-tertiary" />
        )}
      </button>
      {expanded && artifact.content && (
        <div className="px-4 pb-4 border-t border-[rgba(255,255,255,0.04)]">
          <pre className="text-xs text-secondary bg-black/30 rounded p-2 overflow-auto max-h-48 mt-3">
            {JSON.stringify(artifact.content, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function ArtifactsTab({ actionId }) {
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [bundleSummary, setBundleSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/actions/${actionId}/artifacts`);
        if (res.ok) {
          const data = await res.json();
          setArtifacts(data.artifacts || []);
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [actionId]);

  async function handleGenerateBundle() {
    setGenerating(true);
    setError(null);
    setBundleSummary(null);
    try {
      const res = await fetch('/api/artifacts/evidence-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_id: actionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error === 'action_not_found' ? 'Action not found.' : (data.error || 'Failed to generate evidence bundle.'));
        return;
      }
      // Surface the assembled bundle the endpoint returns (previously discarded).
      setBundleSummary({
        steps: Array.isArray(data.steps) ? data.steps.length : 0,
        artifacts: Array.isArray(data.artifacts) ? data.artifacts.length : 0,
        generated_at: data.generated_at,
      });
      // Refresh artifacts list to show the new bundle
      const listRes = await fetch(`/api/actions/${actionId}/artifacts`);
      if (listRes.ok) {
        const list = await listRes.json();
        setArtifacts(list.artifacts || []);
      }
    } catch (err) {
      setError(err.message || 'Failed to generate evidence bundle.');
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-tertiary py-4">Loading artifacts...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-tertiary">
          {artifacts.length} artifact{artifacts.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={handleGenerateBundle}
          disabled={generating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand/10 text-brand border border-brand/20 hover:bg-brand/20 transition-colors disabled:opacity-50"
        >
          <Package className="w-3 h-3" />
          {generating ? 'Generating...' : 'Generate Evidence Bundle'}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-error/20 bg-error-subtle px-3 py-2 text-xs text-error">
          {error}
        </div>
      )}

      {bundleSummary && (
        <div role="status" className="rounded-lg border border-success/20 bg-success-subtle px-3 py-2 text-xs text-success">
          Evidence bundle generated — {bundleSummary.steps} step{bundleSummary.steps === 1 ? '' : 's'}, {bundleSummary.artifacts} artifact{bundleSummary.artifacts === 1 ? '' : 's'}
          {bundleSummary.generated_at ? ` · ${new Date(bundleSummary.generated_at).toLocaleString()}` : ''}.
        </div>
      )}

      {artifacts.length === 0 ? (
        <div className="text-sm text-tertiary py-8 text-center">
          No artifacts linked to this action yet.
        </div>
      ) : (
        <div className="space-y-2">
          {artifacts.map((a) => (
            <ArtifactRow key={a.artifact_id} artifact={a} />
          ))}
        </div>
      )}
    </div>
  );
}
