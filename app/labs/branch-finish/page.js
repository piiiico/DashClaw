'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FileCode, BookOpen, Search, Play,
  RefreshCw, Zap, Activity, ShieldCheck,
} from 'lucide-react';
import PageLayout from '../../components/PageLayout';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { StatCompact } from '../../components/ui/Stat';
import { EmptyState } from '../../components/ui/EmptyState';
import { ListSkeleton } from '../../components/ui/Skeleton';
import MissionControlCapabilityHealthCard from '../../components/MissionControlCapabilityHealthCard';

// The "Branch Finish" knowledge collection name the seed script creates; we
// match on either label so an operator who named it "Coding Standards" still
// lands the right collection.
const STANDARDS_NAME_MATCHES = ['branch finish', 'coding standards'];

export default function BranchFinishPage() {
  // ---- Branch-finish templates ----------------------------------------
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [renderVars, setRenderVars] = useState({});
  const [renderResult, setRenderResult] = useState(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState(null);

  // ---- Standards knowledge --------------------------------------------
  const [standardsCollection, setStandardsCollection] = useState(null);
  const [standardsLoading, setStandardsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [embeddingNote, setEmbeddingNote] = useState(null);

  // ---- Capability health ----------------------------------------------
  const [capabilities, setCapabilities] = useState([]);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);
  const [capabilitiesError, setCapabilitiesError] = useState(null);

  // ---- Quality dry-run -------------------------------------------------
  const [scorerKeywords, setScorerKeywords] = useState('');
  const [scorerSample, setScorerSample] = useState('');
  const [scorerResult, setScorerResult] = useState(null);
  const [scoring, setScoring] = useState(false);
  const [scorerError, setScorerError] = useState(null);

  // ---- Recent activity -------------------------------------------------
  const [runs, setRuns] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);

  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const res = await fetch('/api/prompts/templates?category=branch-finish');
      if (!res.ok) throw new Error('Failed to load templates');
      const d = await res.json();
      setTemplates(d.templates || []);
    } catch (err) {
      setTemplatesError(err.message);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  const fetchStandards = useCallback(async () => {
    setStandardsLoading(true);
    try {
      const res = await fetch('/api/knowledge/collections?limit=100');
      if (!res.ok) throw new Error('Failed to load collections');
      const d = await res.json();
      const match = (d.collections || []).find((c) =>
        STANDARDS_NAME_MATCHES.some((needle) => (c.name || '').toLowerCase().includes(needle))
      );
      setStandardsCollection(match || null);
    } catch {
      setStandardsCollection(null);
    } finally {
      setStandardsLoading(false);
    }
  }, []);

  const fetchCapabilities = useCallback(async () => {
    setCapabilitiesLoading(true);
    setCapabilitiesError(null);
    try {
      const res = await fetch('/api/capabilities/health?limit=10');
      if (!res.ok) throw new Error('Failed to load capability health');
      const d = await res.json();
      setCapabilities(d.capabilities || []);
    } catch (err) {
      setCapabilitiesError(err.message);
    } finally {
      setCapabilitiesLoading(false);
    }
  }, []);

  const fetchActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      const [runsRes, learningRes] = await Promise.all([
        fetch('/api/prompts/runs?limit=10'),
        fetch('/api/learning?limit=10'),
      ]);
      if (runsRes.ok) { const d = await runsRes.json(); setRuns(d.runs || []); }
      if (learningRes.ok) { const d = await learningRes.json(); setDecisions(d.decisions || []); }
    } catch {
      /* leave empty states in place */
    } finally {
      setActivityLoading(false);
    }
  }, []);

  const refreshAll = useCallback(() => {
    fetchTemplates();
    fetchStandards();
    fetchCapabilities();
    fetchActivity();
  }, [fetchTemplates, fetchStandards, fetchCapabilities, fetchActivity]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  // Select a template: render its active version once so we discover its
  // parameters, then seed an empty value for each so the operator gets a form.
  const handleSelectTemplate = async (t) => {
    if (selectedTemplate?.id === t.id) {
      setSelectedTemplate(null);
      setRenderResult(null);
      setRenderVars({});
      setRenderError(null);
      return;
    }
    setSelectedTemplate(t);
    setRenderResult(null);
    setRenderError(null);
    setRendering(true);
    try {
      const res = await fetch('/api/prompts/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: t.id, variables: {} }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Render failed');
      setRenderResult(d);
      const seeded = {};
      (d.parameters || []).forEach((p) => { seeded[p] = ''; });
      setRenderVars(seeded);
    } catch (err) {
      setRenderError(err.message);
    } finally {
      setRendering(false);
    }
  };

  const handleRender = async () => {
    if (!selectedTemplate) return;
    setRendering(true);
    setRenderError(null);
    try {
      const res = await fetch('/api/prompts/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: selectedTemplate.id, variables: renderVars }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Render failed');
      setRenderResult(d);
    } catch (err) {
      setRenderError(err.message);
    } finally {
      setRendering(false);
    }
  };

  const runSearch = async () => {
    if (!standardsCollection || !searchQuery.trim()) return;
    setSearching(true);
    setSearchResults(null);
    setEmbeddingNote(null);
    try {
      const res = await fetch(`/api/knowledge/collections/${standardsCollection.collection_id}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim(), limit: 5 }),
      });
      const d = await res.json();
      if (res.status === 400 && (d.error || '').includes('API key')) {
        setEmbeddingNote('Semantic search needs an embedding key (BYOK OpenAI). Add one in Settings to query coding standards by meaning; the rest of the loop works without it.');
        return;
      }
      if (!res.ok) throw new Error(d.error || 'Search failed');
      setSearchResults(d.results || []);
    } catch (err) {
      setSearchResults({ error: err.message });
    } finally {
      setSearching(false);
    }
  };

  const runScorer = async () => {
    const keywords = scorerKeywords.split(',').map((k) => k.trim()).filter(Boolean);
    setScoring(true);
    setScorerError(null);
    setScorerResult(null);
    try {
      const res = await fetch('/api/evaluations/scorers/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scorer_type: 'contains',
          config: { keywords },
          sample: { outcome: scorerSample },
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Preview failed');
      setScorerResult(d.result);
    } catch (err) {
      setScorerError(err.message);
    } finally {
      setScoring(false);
    }
  };

  const unhealthyCount = capabilities.filter((c) => ['unhealthy', 'failing'].includes(c.status)).length;
  const staleCount = capabilities.filter((c) => c.stale_check || c.certification_status === 'stale').length;

  return (
    <PageLayout
      title="Branch Finish"
      subtitle="The MoltFire + Claude Code branch-finish loop — render the finish prompt, check coding standards, verify capability health, and dry-run the quality gate before you merge."
      breadcrumbs={['Labs', 'Branch Finish']}
      maturity="experimental"
      actions={
        <button
          onClick={refreshAll}
          aria-label="Refresh"
          className="p-2 rounded-lg text-secondary hover:text-white hover:bg-white/5 transition-colors"
        >
          <RefreshCw size={16} />
        </button>
      }
    >
      <div className="space-y-6">
        {/* Stat rail */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Finish templates" value={templatesLoading ? '--' : templates.length} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Standards" value={standardsLoading ? '--' : (standardsCollection ? standardsCollection.doc_count ?? '0' : '0')} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Unhealthy capabilities" value={capabilitiesLoading ? '--' : unhealthyCount} color={unhealthyCount > 0 ? 'text-error' : 'text-white'} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Stale checks" value={capabilitiesLoading ? '--' : staleCount} color={staleCount > 0 ? 'text-warning' : 'text-white'} />
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* (b) Branch-finish templates */}
          <Card>
            <CardHeader title="Branch-finish templates" icon={FileCode} count={templates.length} />
            <CardContent>
              {templatesLoading ? (
                <ListSkeleton />
              ) : templatesError ? (
                <div className="rounded-lg border border-error/20 bg-error-subtle px-3 py-2 text-xs text-error">{templatesError}</div>
              ) : templates.length === 0 ? (
                <EmptyState
                  icon={FileCode}
                  title="No branch-finish templates"
                  description="Seed the loop with node scripts/seed-branch-finish-loop.mjs, or create a template in the branch-finish category on the Prompts page."
                />
              ) : (
                <div className="space-y-1">
                  {templates.map((t) => (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectTemplate(t)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectTemplate(t); }
                      }}
                      className={`w-full flex items-center justify-between py-2 px-3 rounded-lg text-left transition-colors cursor-pointer focus:outline-none ${selectedTemplate?.id === t.id ? 'bg-brand/10 border border-brand/30' : 'bg-surface-tertiary border border-border hover:border-border-hover'}`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-white font-medium truncate">{t.name}</div>
                        {t.description && <div className="text-xs text-tertiary truncate">{t.description}</div>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {t.active_version != null && <Badge variant="success" size="xs">v{t.active_version}</Badge>}
                        <span className="text-[10px] text-disabled">{t.version_count || 0} ver</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Inline render for the selected template */}
              {selectedTemplate && (
                <div className="mt-4 rounded-lg border border-border bg-surface-tertiary p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">Render: {selectedTemplate.name}</span>
                    {renderResult?.version != null && <Badge size="xs">v{renderResult.version}</Badge>}
                  </div>

                  {renderError && (
                    <div className="rounded-md border border-error/20 bg-error-subtle px-3 py-2 text-xs text-error">{renderError}</div>
                  )}

                  {renderResult?.parameters && renderResult.parameters.length > 0 && (
                    <div className="space-y-2">
                      {renderResult.parameters.map((p) => (
                        <div key={p} className="flex items-center gap-2">
                          <label className="w-32 shrink-0 text-xs text-tertiary font-mono truncate">{`{{${p}}}`}</label>
                          <input
                            value={renderVars[p] ?? ''}
                            onChange={(e) => setRenderVars((s) => ({ ...s, [p]: e.target.value }))}
                            placeholder="value"
                            className="flex-1 px-2 py-1 rounded bg-surface-secondary border border-border text-xs text-white placeholder:text-disabled focus:outline-none focus:border-brand"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      onClick={handleRender}
                      disabled={rendering}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
                    >
                      <Play size={12} /> {rendering ? 'Rendering…' : 'Render'}
                    </button>
                  </div>

                  {renderResult?.rendered != null && (
                    <pre className="text-xs text-secondary bg-surface-secondary p-3 rounded-lg border border-border max-h-[260px] overflow-y-auto whitespace-pre-wrap font-mono">{renderResult.rendered}</pre>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* (c) Standards knowledge */}
          <Card>
            <CardHeader title="Standards knowledge" icon={BookOpen} />
            <CardContent>
              {standardsLoading ? (
                <ListSkeleton />
              ) : !standardsCollection ? (
                <EmptyState
                  icon={BookOpen}
                  title="No standards collection"
                  description="Run node scripts/seed-branch-finish-loop.mjs to create the Branch Finish / Coding Standards knowledge collection, then sync it."
                />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white font-medium truncate">{standardsCollection.name}</span>
                    <Badge size="xs">{standardsCollection.doc_count ?? 0} items</Badge>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                      placeholder="Ask the coding standards… (e.g. how should I name branches?)"
                      className="flex-1 px-3 py-2 rounded-lg bg-surface-tertiary border border-border text-sm text-white placeholder:text-disabled focus:outline-none focus:border-brand"
                    />
                    <button
                      onClick={runSearch}
                      disabled={searching || !searchQuery.trim()}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
                    >
                      <Search size={14} /> {searching ? 'Searching…' : 'Search'}
                    </button>
                  </div>

                  {embeddingNote && (
                    <div className="rounded-lg border border-warning/20 bg-warning-subtle px-3 py-2 text-xs text-warning">{embeddingNote}</div>
                  )}

                  {searchResults?.error && (
                    <div className="rounded-lg border border-error/20 bg-error-subtle px-3 py-2 text-xs text-error">{searchResults.error}</div>
                  )}

                  {Array.isArray(searchResults) && (
                    searchResults.length === 0 ? (
                      <div className="text-xs text-tertiary py-4 text-center">No matching standards. Sync the collection first if it is empty.</div>
                    ) : (
                      <div className="space-y-2">
                        {searchResults.map((r, i) => (
                          <div key={r.chunk_id} className="px-3 py-2 rounded-lg bg-surface-tertiary border border-border">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] text-tertiary font-mono">#{i + 1} {r.title || ''}</span>
                              <span className="text-[10px] text-tertiary font-mono">score {(r.score * 100).toFixed(1)}%</span>
                            </div>
                            <div className="text-xs text-secondary whitespace-pre-wrap line-clamp-4">{r.content}</div>
                            {r.source_uri && <div className="text-[10px] text-disabled font-mono mt-1 truncate">{r.source_uri}</div>}
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* (d) Capability health */}
          <MissionControlCapabilityHealthCard
            loading={capabilitiesLoading}
            error={capabilitiesError}
            capabilities={capabilities}
          />

          {/* (e) Branch-finish quality (dry-run) */}
          <Card>
            <CardHeader title="Branch-finish quality (dry-run)" icon={ShieldCheck} />
            <CardContent>
              <div className="space-y-3">
                <p className="text-xs text-tertiary">
                  Dry-run a <span className="font-mono text-secondary">contains</span> scorer against a sample branch-finish outcome. Side-effect-free — no eval row is written.
                </p>
                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Required keywords (comma-separated)</label>
                  <input
                    value={scorerKeywords}
                    onChange={(e) => setScorerKeywords(e.target.value)}
                    placeholder="tests pass, lint clean, build green"
                    className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-border text-sm text-white placeholder:text-disabled focus:outline-none focus:border-brand"
                  />
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Sample outcome</label>
                  <textarea
                    value={scorerSample}
                    onChange={(e) => setScorerSample(e.target.value)}
                    rows={4}
                    placeholder="Paste the branch-finish summary an agent produced…"
                    className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-border text-sm text-white placeholder:text-disabled focus:outline-none focus:border-brand font-mono"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={runScorer}
                    disabled={scoring}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
                  >
                    <Play size={12} /> {scoring ? 'Scoring…' : 'Run dry-run'}
                  </button>
                </div>

                {scorerError && (
                  <div className="rounded-lg border border-error/20 bg-error-subtle px-3 py-2 text-xs text-error">{scorerError}</div>
                )}

                {scorerResult && (
                  <div className="rounded-lg border border-border bg-surface-tertiary p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={scorerResult.label === 'pass' ? 'success' : scorerResult.label === 'fail' ? 'error' : 'default'} size="xs">
                        {scorerResult.label || 'n/a'}
                      </Badge>
                      <span className="text-sm font-semibold tabular-nums text-white">
                        score {scorerResult.score != null ? scorerResult.score : '--'}
                      </span>
                    </div>
                    {scorerResult.reasoning && <p className="text-xs text-secondary whitespace-pre-wrap">{scorerResult.reasoning}</p>}
                    {scorerResult.error && <p className="text-xs text-error">{scorerResult.error}</p>}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* (f) Recent activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader title="Recent renders" icon={Play} count={runs.length} />
            <CardContent>
              {activityLoading ? (
                <ListSkeleton />
              ) : runs.length === 0 ? (
                <EmptyState icon={Play} title="No prompt runs yet" description="Render a branch-finish prompt with record=true to track usage here." />
              ) : (
                <div className="space-y-2">
                  {runs.map((run) => (
                    <div key={run.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-tertiary border border-border">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm text-white font-medium truncate">{run.template_name}</span>
                        <Badge size="xs">v{run.version}</Badge>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-tertiary tabular-nums">{run.tokens_used || 0} tok</span>
                        <span className="text-[10px] text-disabled">{run.created_at ? new Date(run.created_at).toLocaleDateString() : ''}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Recent decisions" icon={Zap} count={decisions.length} />
            <CardContent>
              {activityLoading ? (
                <ListSkeleton />
              ) : decisions.length === 0 ? (
                <EmptyState icon={Activity} title="No decisions logged" description="Branch-finish decisions recorded via /api/learning appear here." />
              ) : (
                <div className="space-y-2">
                  {decisions.map((d) => (
                    <div key={d.id} className="py-2 px-3 rounded-lg bg-surface-tertiary border border-border">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-white truncate">{d.decision}</span>
                        <Badge size="xs" variant={d.outcome === 'success' ? 'success' : d.outcome === 'failure' ? 'error' : 'default'}>
                          {d.outcome || 'pending'}
                        </Badge>
                      </div>
                      {d.timestamp && <div className="text-[10px] text-disabled mt-0.5">{new Date(d.timestamp).toLocaleString()}</div>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}
