'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
  BarChart3, Layers, ArrowRightLeft, Code2, UserCog, Brain,
  RefreshCw, ChevronDown, ChevronUp, Copy, Check,
  ArrowLeft, X, Clock, Zap, BookOpen, FileText, Lightbulb,
  Users, Target, MessageSquare, ShieldAlert, CalendarClock,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatCompact } from '../components/ui/Stat';
import { EmptyState } from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { ProgressBar } from '../components/ui/ProgressBar';
import { HelpIcon } from '../components/HelpIcon';
import { HELP_TIPS } from '../lib/demo/fixtures/help-tips.js';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { getAgentColor } from '../lib/colors';

// --- Helpers ---

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function safeParseJson(str) {
  if (!str) return [];
  if (Array.isArray(str)) return str;
  try { return JSON.parse(str); } catch { return []; }
}

function cronToHuman(expr) {
  if (!expr) return expr;
  const parts = expr.split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  if (min === '0' && hour.startsWith('*/')) return `Every ${hour.slice(2)} hours`;
  if (min.startsWith('*/')) return `Every ${min.slice(2)} minutes`;
  if (hour === '*' && min !== '*') return `Every hour at :${min.padStart(2, '0')}`;
  if (dom === '*' && mon === '*' && dow === '*' && hour !== '*' && min !== '*') return `Daily at ${hour}:${min.padStart(2, '0')}`;
  return expr;
}

const CATEGORY_VARIANTS = {
  decision: 'info', task: 'warning', insight: 'success',
  question: 'brand', general: 'default',
};

const TABS = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'handoffs', label: 'Handoffs', icon: ArrowRightLeft },
  { key: 'snippets', label: 'Snippets', icon: Code2 },
  { key: 'preferences', label: 'Preferences', icon: UserCog },
  { key: 'memory', label: 'Memory', icon: Brain },
];

// ============================================================
// Tab 1 — Overview (Digest)
// ============================================================

function OverviewTab({ agentId, dense }) {
  const [date, setDate] = useState(''); // empty = recent (no date filter)
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [schedules, setSchedules] = useState([]);

  const fetchDigest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (agentId) params.set('agent_id', agentId);
      const [digestRes, schedRes] = await Promise.all([
        fetch(`/api/digest?${params}`),
        fetch(`/api/agent-schedules${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ''}`),
      ]);
      if (!digestRes.ok) {
        setDigest({ digest: { actions: { total: 0, items: [] }, decisions: { total: 0, items: [] }, lessons: { total: 0, items: [] }, stats: {} } });
      } else {
        const data = await digestRes.json();
        setDigest(data);
      }
      if (schedRes.ok) {
        const schedData = await schedRes.json();
        setSchedules(schedData.schedules || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [date, agentId]);

  useEffect(() => { fetchDigest(); }, [fetchDigest]);

  if (loading) return <ListSkeleton rows={5} />;
  if (error) return <div className="text-error text-sm py-4">{error}</div>;
  if (!digest) return <EmptyState icon={BarChart3} title="No digest data" description="No activity recorded" />;

  const d = digest.digest || {};
  const stats = [
    { label: 'Actions', value: d.actions?.total || 0, color: 'text-brand' },
    { label: 'Decisions', value: d.decisions?.total || 0, color: 'text-info' },
    { label: 'Lessons', value: d.lessons?.total || 0, color: 'text-success' },
    { label: 'Content', value: d.content?.total || 0, color: 'text-purple-400' },
    { label: 'Ideas', value: d.ideas?.total || 0, color: 'text-warning' },
    { label: 'Interactions', value: d.interactions?.total || 0, color: 'text-cyan-400' },
    { label: 'Goals', value: d.goals?.total || 0, color: 'text-error' },
  ];

  const sections = [
    { key: 'actions', label: 'Actions', icon: Zap, items: d.actions?.items || [], total: d.actions?.total || 0, variant: 'warning',
      render: (a) => <span>{a.action_type || a.type}: {a.declared_goal || a.goal || a.description || a.action_id}</span>,
      time: (a) => a.timestamp_start },
    { key: 'decisions', label: 'Decisions', icon: BookOpen, items: d.decisions?.items || [], total: d.decisions?.total || 0, variant: 'info',
      render: (d) => <span>{d.title || d.decision || d.content}</span>,
      time: (d) => d.timestamp },
    { key: 'lessons', label: 'Lessons', icon: BookOpen, items: d.lessons?.items || [], total: d.lessons?.total || 0, variant: 'success',
      render: (l) => <span>{l.title || l.lesson || l.content}</span>,
      time: (l) => l.timestamp },
    { key: 'content', label: 'Content', icon: FileText, items: d.content?.items || [], total: d.content?.total || 0, variant: 'brand',
      render: (c) => <span>{c.title || c.content_type}: {c.description || c.url || ''}</span>,
      time: (c) => c.created_at },
    { key: 'ideas', label: 'Ideas', icon: Lightbulb, items: d.ideas?.items || [], total: d.ideas?.total || 0, variant: 'warning',
      render: (i) => <span>{i.title || i.idea || i.content}</span>,
      time: (i) => i.captured_at },
    { key: 'interactions', label: 'Interactions', icon: Users, items: d.interactions?.items || [], total: d.interactions?.total || 0, variant: 'default',
      render: (i) => <span>{i.contact_name || i.direction || i.type}: {i.summary || i.notes || ''}</span>,
      time: (i) => i.created_at },
    { key: 'goals', label: 'Goals', icon: Target, items: d.goals?.items || [], total: d.goals?.total || 0, variant: 'success',
      render: (g) => <span>{g.title || g.goal}: {g.status || ''}</span>,
      time: (g) => g.created_at },
  ];

  const isFiltered = !!date;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="flex items-center text-sm font-medium text-secondary">
          Digest
          <HelpIcon sectionKey="workspace-digest" tip={HELP_TIPS['workspace-digest']} />
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDate('')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${
              !isFiltered
                ? 'bg-brand/10 border-brand text-brand'
                : 'bg-surface-secondary border-border text-secondary hover:text-secondary'
            }`}
          >
            Recent
          </button>
          <div className="flex items-center gap-1.5">
            <Clock size={14} className="text-tertiary" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-md bg-surface-secondary border border-border text-secondary [color-scheme:dark]"
            />
          </div>
        </div>
        {isFiltered && (
          <button
            onClick={() => setDate('')}
            className="flex items-center gap-1 text-xs text-tertiary hover:text-secondary transition-colors"
          >
            <X size={12} /> Clear filter
          </button>
        )}
        <span className="text-xs text-tertiary ml-auto">
          {isFiltered ? `Showing ${formatDate(date)}` : 'Showing recent activity'}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        {stats.map(s => (
          <Card key={s.label} hover={false}>
            <CardContent className={dense ? "pt-2 pb-2" : "pt-3 pb-3"}>
              <StatCompact label={s.label} value={s.value} color={s.color} />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-4">
        {sections.filter(s => s.items.length > 0).map(section => (
          <Card key={section.key} hover={false}>
            <CardHeader title={section.label} icon={section.icon} count={section.total} />
            <CardContent className={dense ? "pt-2 pb-2" : ""}>
              <div className={dense ? "space-y-1" : "space-y-2"}>
                {section.items.slice(0, 10).map((item, idx) => (
                  <div key={item.id || idx} className="flex items-start gap-2 text-sm text-secondary">
                    <Badge variant={section.variant} size="xs">{section.key}</Badge>
                    <span className="flex-1 min-w-0 truncate">{section.render(item)}</span>
                    {!isFiltered && section.time(item) && (
                      <span className="text-[10px] text-tertiary whitespace-nowrap shrink-0">{timeAgo(section.time(item))}</span>
                    )}
                  </div>
                ))}
                {section.total > 10 && (
                  <div className="text-xs text-tertiary">+{section.total - Math.min(section.items.length, 10)} more</div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {sections.every(s => s.items.length === 0) && (
          <EmptyState icon={BarChart3} title="No activity" description={isFiltered ? `No data recorded for ${formatDate(date)}` : 'No activity recorded yet'} />
        )}
      </div>

      {/* Scheduled Activities */}
      {schedules.length > 0 && (
        <Card hover={false} className="mt-6">
          <CardHeader title="Scheduled Activities" icon={CalendarClock} count={schedules.length} />
          <CardContent className={dense ? "pt-2 pb-2" : ""}>
            <div className={dense ? "space-y-1" : "space-y-2"}>
              {schedules.map(s => (
                <div key={s.id} className="flex items-center gap-3 text-sm">
                  <Badge variant={s.enabled ? 'success' : 'default'} size="xs">
                    {s.agent_id}
                  </Badge>
                  <span className="text-secondary flex-1 min-w-0 truncate">{s.name}</span>
                  <span className="text-xs text-tertiary shrink-0">{cronToHuman(s.cron_expression)}</span>
                  {s.last_run && (
                    <span className="text-[10px] text-disabled shrink-0">Last: {timeAgo(s.last_run)}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3 mt-6">
        <Link href="/messages" className="flex items-center gap-1.5 text-sm text-secondary hover:text-brand transition-colors">
          <MessageSquare size={14} /> Messages
        </Link>
        <Link href="/security" className="flex items-center gap-1.5 text-sm text-secondary hover:text-brand transition-colors">
          <ShieldAlert size={14} /> Security
        </Link>
      </div>
    </div>
  );
}

// ============================================================
// Tab 3 — Handoffs
// ============================================================

function HandoffsTab({ agentId, dense }) {
  const [handoffs, setHandoffs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});

  const fetchHandoffs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (agentId) params.set('agent_id', agentId);
      const res = await fetch(`/api/handoffs?${params}`);
      if (!res.ok) throw new Error('Failed to fetch handoffs');
      const data = await res.json();
      setHandoffs(data.handoffs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchHandoffs(); }, [fetchHandoffs]);

  function toggleSection(handoffId, section) {
    setExpanded(prev => {
      const key = `${handoffId}-${section}`;
      return { ...prev, [key]: !prev[key] };
    });
  }

  if (loading) return <ListSkeleton rows={5} />;
  if (error) return <div className="text-error text-sm py-4">{error}</div>;
  if (handoffs.length === 0) return <EmptyState icon={ArrowRightLeft} title="No handoffs" description="Session handoffs will appear here when agents create them" />;

  return (
    <div className={`space-y-${dense ? '2' : '4'}`}>
      <span className="flex items-center text-sm font-medium text-secondary mb-2">
        Session Handoffs
        <HelpIcon sectionKey="handoffs" tip={HELP_TIPS['handoffs']} />
      </span>
      {handoffs.map(h => {
        // The stored handoff bundle is freeform JSON; the canonical keys
        // (summary, decisions_made, open_loops, state_snapshot) are what the
        // SDKs write. The tab previously read a legacy flat shape that never
        // existed in this API.
        const bundle = h.bundle || {};
        const asItems = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
        const stateItems = bundle.state_snapshot
          ? (typeof bundle.state_snapshot === 'object'
              ? Object.entries(bundle.state_snapshot).map(([k, val]) => `${k}: ${typeof val === 'object' ? JSON.stringify(val) : val}`)
              : [String(bundle.state_snapshot)])
          : [];
        const agentColor = getAgentColor(h.agent_id);

        const sections = [
          { key: 'decisions', label: 'Decisions Made', items: asItems(bundle.decisions_made) },
          { key: 'open_loops', label: 'Open Loops', items: asItems(bundle.open_loops) },
          { key: 'state', label: 'State Snapshot', items: stateItems },
        ];

        return (
          <Card key={h.id} hover={false}>
            <CardContent className={dense ? "pt-3 pb-3" : "pt-4"}>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-xs text-tertiary">{formatDate(h.created_at)}</span>
                {h.agent_id && (
                  <Badge variant="default" size="xs" className={agentColor}>{h.agent_id}</Badge>
                )}
              </div>
              <div className="text-sm text-secondary mb-3">{bundle.summary}</div>
              <div className="space-y-1">
                {sections.filter(s => s.items.length > 0).map(section => {
                  const isOpen = expanded[`${h.id}-${section.key}`];
                  return (
                    <div key={section.key}>
                      <button
                        onClick={() => toggleSection(h.id, section.key)}
                        className="flex items-center gap-1.5 text-xs text-secondary hover:text-secondary py-1 transition-colors"
                      >
                        {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        {section.label} ({section.items.length})
                      </button>
                      {isOpen && (
                        <ul className="ml-5 mt-1 mb-2 space-y-1">
                          {section.items.map((item, idx) => (
                            <li key={idx} className="text-xs text-secondary flex items-start gap-1.5">
                              <span className="text-disabled mt-1 shrink-0">&#x2022;</span>
                              <span>{typeof item === 'string' ? item : item.text || item.title || JSON.stringify(item)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ============================================================
// Tab 4 — Snippets
// ============================================================

function SnippetsTab({ agentId, dense }) {
  const [snippets, setSnippets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [langFilter, setLangFilter] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const searchTimer = useRef(null);

  const fetchSnippets = useCallback(async (q, lang) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set('search', q);
      if (lang) params.set('language', lang);
      if (agentId) params.set('agent_id', agentId);
      const res = await fetch(`/api/snippets?${params}`);
      if (!res.ok) throw new Error('Failed to fetch snippets');
      const data = await res.json();
      setSnippets(data.snippets || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchSnippets(search, langFilter); }, [fetchSnippets, search, langFilter]);

  function handleSearchInput(val) {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 300);
  }

  async function handleCopy(code, id) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* ignore */ }
  }

  async function handleUse(snippetId) {
    try {
      await fetch(`/api/snippets/${snippetId}/use`, { method: 'POST' });
      setSnippets(prev => prev.map(s =>
        s.id === snippetId ? { ...s, use_count: (s.use_count || 0) + 1 } : s
      ));
    } catch { /* ignore */ }
  }

  const languages = useMemo(() => [...new Set(snippets.map(s => s.language).filter(Boolean))].sort(), [snippets]);

  return (
    <div>
      <span className="flex items-center text-sm font-medium text-secondary mb-3">
        Snippets
        <HelpIcon sectionKey="snippets" tip={HELP_TIPS['snippets']} />
      </span>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          defaultValue=""
          onChange={(e) => handleSearchInput(e.target.value)}
          placeholder="Search snippets..."
          className="flex-1 px-3 py-1.5 text-sm rounded-md bg-surface-secondary border border-border text-secondary placeholder-zinc-500"
        />
        <select
          value={langFilter}
          onChange={(e) => setLangFilter(e.target.value)}
          className="px-2 py-1.5 text-sm rounded-md bg-surface-secondary border border-border text-secondary [color-scheme:dark]"
        >
          <option value="">All Languages</option>
          {languages.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      {loading ? <ListSkeleton rows={3} /> : error ? (
        <div className="text-error text-sm py-4">{error}</div>
      ) : snippets.length === 0 ? (
        <EmptyState icon={Code2} title="No snippets" description="Save reusable code snippets via the SDK" />
      ) : (
        <div className={`space-y-${dense ? '2' : '4'}`}>
          {snippets.map(s => {
            const tags = safeParseJson(s.tags);
            return (
              <Card key={s.id} hover={false}>
                <CardContent className={dense ? "pt-3" : "pt-4"}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-secondary">{s.name}</span>
                    {s.language && <Badge variant="info" size="xs">{s.language}</Badge>}
                    <span className="ml-auto text-[10px] text-tertiary">Used {s.use_count || 0}x</span>
                  </div>
                  {s.description && <div className="text-xs text-secondary mb-2">{s.description}</div>}
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {tags.map((tag, i) => <Badge key={i} variant="default" size="xs">{tag}</Badge>)}
                    </div>
                  )}
                  <div className="relative">
                    <pre className={`font-mono text-xs text-secondary bg-black/30 rounded-md overflow-x-auto max-h-[300px] overflow-y-auto border border-border ${dense ? 'p-2' : 'p-3'}`}>
                      {s.code}
                    </pre>
                    <div className="absolute top-2 right-2 flex gap-1">
                      <button
                        onClick={() => handleCopy(s.code, s.id)}
                        className="p-1 rounded bg-white/10 hover:bg-white/20 text-secondary hover:text-secondary transition-colors"
                        title="Copy code"
                      >
                        {copiedId === s.id ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                      <button
                        onClick={() => handleUse(s.id)}
                        className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px] text-secondary hover:text-secondary transition-colors"
                        title="Mark as used"
                      >
                        Use
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Tab 5 — Preferences
// ============================================================

function PreferencesTab({ agentId, dense }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [drilldown, setDrilldown] = useState(null);
  const [drilldownData, setDrilldownData] = useState([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ type: 'summary' });
      if (agentId) params.set('agent_id', agentId);
      const res = await fetch(`/api/preferences?${params}`);
      if (!res.ok) throw new Error('Failed to fetch preferences');
      const data = await res.json();
      setSummary(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  async function handleDrilldown(type) {
    setDrilldown(type);
    setDrilldownLoading(true);
    try {
      const params = new URLSearchParams({ type });
      if (agentId) params.set('agent_id', agentId);
      const res = await fetch(`/api/preferences?${params}`);
      if (!res.ok) throw new Error('Failed to fetch details');
      const data = await res.json();
      setDrilldownData(data.items || data.observations || data.preferences || data.moods || data.approaches || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setDrilldownLoading(false);
    }
  }

  if (loading) return <ListSkeleton rows={4} />;
  if (error) return <div className="text-error text-sm py-4">{error}</div>;

  if (drilldown) {
    return (
      <div>
        <button
          onClick={() => { setDrilldown(null); setDrilldownData([]); }}
          className="flex items-center gap-1 text-sm text-secondary hover:text-brand mb-4 transition-colors"
        >
          <ArrowLeft size={14} /> Back to summary
        </button>
        <h3 className="text-sm font-medium text-secondary capitalize mb-3">{drilldown}</h3>
        {drilldownLoading ? <ListSkeleton rows={4} /> : drilldownData.length === 0 ? (
          <EmptyState icon={UserCog} title={`No ${drilldown}`} description={`No ${drilldown} recorded yet`} />
        ) : (
          <div className={dense ? "space-y-1" : "space-y-2"}>
            {drilldown === 'observations' && drilldownData.map((item, i) => (
              <Card key={item.id || i} hover={false}>
                <CardContent className={dense ? "pt-2 pb-2" : "pt-3 pb-3"}>
                  <div className="flex items-start gap-2 text-sm">
                    {item.category && <Badge variant={CATEGORY_VARIANTS[item.category] || 'default'} size="xs">{item.category}</Badge>}
                    <span className="flex-1 text-secondary">{item.observation}</span>
                    {item.importance && (
                      <span className="text-[10px] text-tertiary">imp: {item.importance}</span>
                    )}
                  </div>
                  <div className="text-[10px] text-tertiary mt-1">{timeAgo(item.created_at)}</div>
                </CardContent>
              </Card>
            ))}
            {drilldown === 'preferences' && drilldownData.map((item, i) => (
              <Card key={item.id || i} hover={false}>
                <CardContent className={dense ? "pt-2 pb-2" : "pt-3 pb-3"}>
                  <div className="flex items-center gap-2 mb-1">
                    {item.category && <Badge variant="info" size="xs">{item.category}</Badge>}
                    <span className="text-sm text-secondary">{item.preference}</span>
                  </div>
                  <ProgressBar value={item.confidence || 0} color="brand" className="mt-1" />
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-tertiary">{timeAgo(item.created_at)}</span>
                    <span className="text-[10px] text-tertiary">{item.confidence}% confidence</span>
                  </div>
                </CardContent>
              </Card>
            ))}
            {drilldown === 'moods' && drilldownData.map((item, i) => (
              <Card key={item.id || i} hover={false}>
                <CardContent className={dense ? "pt-2 pb-2" : "pt-3 pb-3"}>
                  <div className="text-sm text-secondary font-medium">{item.mood}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-tertiary">Energy:</span>
                    <ProgressBar value={(item.energy || 0) * 10} color={item.energy >= 7 ? 'success' : item.energy >= 4 ? 'warning' : 'error'} className="flex-1" />
                    <span className="text-xs text-secondary">{item.energy}/10</span>
                  </div>
                  {item.notes && <div className="text-xs text-secondary mt-1">{item.notes}</div>}
                  <div className="text-[10px] text-tertiary mt-1">{timeAgo(item.created_at)}</div>
                </CardContent>
              </Card>
            ))}
            {drilldown === 'approaches' && drilldownData.map((item, i) => {
              const total = (item.success_count || 0) + (item.fail_count || 0);
              const ratio = total > 0 ? Math.round((item.success_count / total) * 100) : 0;
              return (
                <Card key={item.id || i} hover={false}>
                  <CardContent className={dense ? "pt-2 pb-2" : "pt-3 pb-3"}>
                    <div className="text-sm text-secondary">{item.approach}</div>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-xs text-success">{item.success_count || 0} success</span>
                      <span className="text-xs text-error">{item.fail_count || 0} fail</span>
                      <span className="text-xs text-secondary">{ratio}% rate</span>
                    </div>
                    {item.context && <div className="text-xs text-secondary mt-1">{item.context}</div>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const obsCount = summary?.observations_count ?? summary?.observations?.length ?? 0;
  const topPrefs = summary?.top_preferences || summary?.preferences?.slice?.(0, 3) || [];
  const recentMoods = summary?.recent_moods || summary?.moods?.slice?.(0, 3) || [];
  const topApproaches = summary?.top_approaches || summary?.approaches?.slice?.(0, 3) || [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card hover={false} className="cursor-pointer" onClick={() => handleDrilldown('observations')}>
        <CardHeader title={<span className="flex items-center">Observations<HelpIcon sectionKey="learning" tip={HELP_TIPS['learning']} /></span>} icon={UserCog} />
        <CardContent>
          <div className="text-2xl font-semibold tabular-nums text-white">{obsCount}</div>
          <div className="text-xs text-tertiary mt-1">observations logged</div>
        </CardContent>
      </Card>

      <Card hover={false} className="cursor-pointer" onClick={() => handleDrilldown('preferences')}>
        <CardHeader title="Preferences" icon={UserCog} />
        <CardContent>
          {topPrefs.length === 0 ? (
            <div className="text-xs text-tertiary">No preferences recorded</div>
          ) : (
            <div className="space-y-2">
              {topPrefs.map((p, i) => (
                <div key={i}>
                  <div className="text-xs text-secondary truncate">{p.preference}</div>
                  <ProgressBar value={p.confidence || 0} color="brand" className="mt-0.5" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card hover={false} className="cursor-pointer" onClick={() => handleDrilldown('moods')}>
        <CardHeader title="Recent Moods" icon={UserCog} />
        <CardContent>
          {recentMoods.length === 0 ? (
            <div className="text-xs text-tertiary">No moods recorded</div>
          ) : (
            <div className="space-y-2">
              {recentMoods.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-secondary">{m.mood}</span>
                  <ProgressBar value={(m.energy || 0) * 10} color={m.energy >= 7 ? 'success' : 'warning'} className="flex-1" />
                  <span className="text-[10px] text-tertiary">{timeAgo(m.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card hover={false} className="cursor-pointer" onClick={() => handleDrilldown('approaches')}>
        <CardHeader title="Top Approaches" icon={UserCog} />
        <CardContent>
          {topApproaches.length === 0 ? (
            <div className="text-xs text-tertiary">No approaches tracked</div>
          ) : (
            <div className="space-y-2">
              {topApproaches.map((a, i) => {
                const total = (a.success_count || 0) + (a.fail_count || 0);
                const ratio = total > 0 ? Math.round((a.success_count / total) * 100) : 0;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-secondary truncate flex-1">{a.approach}</span>
                    <span className="text-[10px] text-success">{a.success_count || 0}</span>
                    <span className="text-[10px] text-disabled">/</span>
                    <span className="text-[10px] text-error">{a.fail_count || 0}</span>
                    <span className="text-[10px] text-tertiary">{ratio}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Tab 6 — Memory
// ============================================================

function MemoryTab({ agentId, dense }) {
  const [memory, setMemory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchMemory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/memory');
      if (!res.ok) throw new Error('Failed to fetch memory');
      const data = await res.json();
      setMemory(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMemory(); }, [fetchMemory]);

  if (loading) return <ListSkeleton rows={5} />;
  if (error) return <div className="text-error text-sm py-4">{error}</div>;
  if (!memory) return <EmptyState icon={Brain} title="No memory data" description="Report memory health via the SDK" />;

  const health = memory.health || memory.latest_snapshot || {};
  const score = health.score ?? health.health_score ?? null;
  const entities = memory.entities || [];
  const topics = memory.topics || [];

  const scoreColor = score >= 80 ? 'text-success' : score >= 50 ? 'text-warning' : 'text-error';

  const metrics = [
    { label: 'Total Files', value: health.totalFiles ?? health.total_files ?? '-' },
    { label: 'Total Lines', value: health.totalLines ?? health.total_lines ?? '-' },
    { label: 'Size (KB)', value: health.totalSizeKb ?? health.total_size_kb ?? '-' },
    { label: 'Days Active', value: health.daysWithNotes ?? health.days_with_notes ?? '-' },
    { label: 'Avg Lines/Day', value: health.avgLinesPerDay ?? health.avg_lines_per_day ?? '-' },
    { label: 'Duplicates', value: health.duplicates ?? '-', warn: (health.duplicates || 0) > 0 },
    { label: 'Stale Facts', value: health.staleCount ?? health.stale_count ?? '-', warn: (health.staleCount || health.stale_count || 0) > 0 },
    { label: 'MEMORY.md', value: health.memoryMdLines ?? health.memory_md_lines ?? '-' },
  ];

  return (
    <div>
      {/* Health Score Hero */}
      <div className="flex items-center justify-center gap-3 mb-6">
        <div className={`text-5xl font-bold tabular-nums ${score !== null ? scoreColor : 'text-tertiary'}`}>
          {score !== null ? score : '—'}
        </div>
        <div>
          <span className="flex items-center text-sm text-secondary">
            Health Score
            <HelpIcon sectionKey="memory-health" tip={HELP_TIPS['memory-health']} />
          </span>
          {agentId && (
            <Badge variant="info" size="xs">Org-wide</Badge>
          )}
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {metrics.map(m => (
          <Card key={m.label} hover={false}>
            <CardContent className={dense ? "pt-2 pb-2" : "pt-3 pb-3"}>
              <StatCompact
                label={m.label}
                value={m.value}
                color={m.warn ? 'text-warning' : 'text-white'}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Entities + Topics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card hover={false}>
          <CardHeader title="Entities" icon={Brain} count={entities.length} />
          <CardContent>
            {entities.length === 0 ? (
              <div className="text-xs text-tertiary">No entities extracted</div>
            ) : (
              <div className={`space-y-1.5 max-h-[400px] overflow-y-auto ${dense ? 'text-xs' : 'text-sm'}`}>
                {[...entities].sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0)).map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {e.type && <Badge variant="info" size="xs">{e.type}</Badge>}
                    <span className="text-secondary flex-1 truncate">{e.name}</span>
                    <span className="text-[10px] text-tertiary tabular-nums">{e.mention_count || 0}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card hover={false}>
          <CardHeader title="Topics" icon={Brain} count={topics.length} />
          <CardContent>
            {topics.length === 0 ? (
              <div className="text-xs text-tertiary">No topics extracted</div>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-[400px] overflow-y-auto">
                {[...topics].sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0)).map((t, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/5 border border-border text-xs text-secondary">
                    {t.name}
                    <span className="text-[10px] text-tertiary">{t.mention_count || 0}</span>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// Main Workspace Page
// ============================================================

export default function WorkspacePage() {
  const { agentId: filterAgentId } = useAgentFilter();
  const [tab, setTab] = useState('overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const [dense, setDense] = useState(false);

  return (
    <PageLayout
      title="Workspace"
      subtitle="Agent tools and context"
      breadcrumbs={['Dashboard', 'Workspace']}
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDense(d => !d)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${
              dense ? 'bg-brand/10 border-brand text-brand' : 'bg-surface-secondary border-border text-secondary hover:text-white'
            }`}
            title="Toggle Dense View"
          >
            <Layers size={14} /> Dense
          </button>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-surface-secondary border border-border text-secondary hover:text-white hover:border-border-hover transition-colors"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      }
    >
      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-[rgba(255,255,255,0.06)] pb-px overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-md transition-colors whitespace-nowrap ${
                active
                  ? 'text-brand border-b-2 border-brand'
                  : 'text-secondary hover:text-secondary'
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {tab === 'overview' && <OverviewTab key={`overview-${refreshKey}`} agentId={filterAgentId} dense={dense} />}
      {tab === 'handoffs' && <HandoffsTab key={`handoffs-${refreshKey}`} agentId={filterAgentId} dense={dense} />}
      {tab === 'snippets' && <SnippetsTab key={`snippets-${refreshKey}`} agentId={filterAgentId} dense={dense} />}
      {tab === 'preferences' && <PreferencesTab key={`preferences-${refreshKey}`} agentId={filterAgentId} dense={dense} />}
      {tab === 'memory' && <MemoryTab key={`memory-${refreshKey}`} agentId={filterAgentId} dense={dense} />}
    </PageLayout>
  );
}

