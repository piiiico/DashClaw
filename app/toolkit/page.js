import Link from 'next/link';
import { Terminal, ArrowLeft, Zap, Brain, Shield, Rocket, HeartPulse, Search, MessageSquare, ClipboardCheck, History, RefreshCw } from 'lucide-react';
import GithubIcon from '../components/GithubIcon';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';

// Tool examples are written as they should be run from inside the installed
// workspace's `tools/` directory (e.g. `~/dashclaw/tools/`), which is where
// `./agent-tools/install-mac.sh` (or install-windows.ps1) copies the bundle.
// Each example uses the actual subdirectory + filename so users can copy
// the command verbatim after `cd ~/dashclaw/tools`.
const toolCategories = [
  {
    title: 'Operations & Continuity',
    icon: Rocket,
    tools: [
      { name: 'session-handoff', desc: 'Generates structured handover documents for agent session continuity.', example: 'python session-handoff/handoff.py create' },
      { name: 'goal-tracker', desc: 'Tracks goals, milestones, and real-time progress markers.', example: 'python goal-tracker/goals.py add "Feature X"' },
      { name: 'daily-digest', desc: 'Aggregates all agent activity into a single daily summary.', example: 'python daily-digest/digest.py generate' },
      { name: 'project-monitor', desc: 'Tracks engagement across different systems and repositories.', example: 'python project-monitor/monitor.py status' },
      { name: 'open-loops', desc: 'Tracks commitments made in conversation so nothing falls through the cracks.', example: 'python open-loops/loops.py add "Follow up with X" --due 2026-02-06' },
      { name: 'api-monitor', desc: 'Tracks external services, rate limits, usage costs, and reliability metrics.', example: 'python api-monitor/apis.py status' },
      { name: 'backup-verify', desc: 'Non-destructive git health checks to verify repo integrity and commit history.', example: 'python backup-verify/verify.py' },
      { name: 'health-check', desc: 'Checks databases, services, critical files, and binaries for system readiness.', example: 'python health-check/health_check.py full' },
    ]
  },
  {
    title: 'Knowledge & Learning',
    icon: Brain,
    tools: [
      { name: 'learning-database', desc: 'Logs key decisions and lessons learned with outcome tracking.', example: 'python learning-database/learner.py log "Decision X"' },
      { name: 'memory-health', desc: 'Scans memory files for duplication, staleness, and knowledge density.', example: 'python memory-health/scanner.py scan' },
      { name: 'context-manager', desc: 'Manages key points and organizes context into topical threads.', example: 'python context-manager/context.py capture' },
      { name: 'memory-search', desc: 'Advanced search utility for semantic lookup across agent memory.', example: 'python memory-search/search.py "auth flow"' },
      { name: 'memory-extractor', desc: 'Turns raw chat logs or notes into structured memory file updates and open-loop drafts.', example: 'python memory-extractor/extract.py --input notes.txt' },
      { name: 'automation-library', desc: 'Stores and retrieves reusable code snippets, commands, and workflows.', example: 'python automation-library/snippets.py search "deploy"' },
    ]
  },
  {
    title: 'Security & Governance',
    icon: Shield,
    tools: [
      { name: 'outbound-filter', desc: 'Scans agent responses for leaked API keys, tokens, or PII.', example: 'python security/outbound_filter.py scan response.txt' },
      { name: 'session-isolator', desc: 'Ensures agent work remains within specific directory boundaries.', example: 'python security/session_isolator.py check .' },
      { name: 'audit-logger', desc: 'Local-first append-only log of all shell commands and external actions executed.', example: 'python security/audit_logger.py tail' },
      { name: 'secret-tracker', desc: 'Tracks API keys, tokens, and credentials and reminds you when to rotate them.', example: 'python security/secret_tracker.py due' },
      { name: 'data-classifier', desc: 'Tags files and content as sensitive, internal, or public and enforces handling rules.', example: 'python security/data_classifier.py classify file.txt' },
      { name: 'skill-checker', desc: 'Static safety scan for third-party skills — flags network exfil, exec patterns, and secrets in code.', example: 'python security/skill_checker.py scan --fail-on high' },
      { name: 'token-optimizer', desc: 'Documents token cost strategies and usage limits to keep agent sessions within budget.', example: 'python token-optimizer/session_check.py' },
    ]
  },
  {
    title: 'Token & Efficiency',
    icon: Zap,
    tools: [
      { name: 'token-capture', desc: 'Captures real token usage from DashClaw sessions and stores it in a local SQLite database.', example: 'python token-capture/capture.py' },
      { name: 'token-tracker', desc: 'Monitors token budget and provides warnings and recommendations during active agent runs.', example: 'python token-efficiency/token-tracker.py status' },
      { name: 'cost-estimator', desc: 'Estimates token costs across different models and suggests efficient alternatives.', example: 'python token-efficiency/cost-estimator.py estimate --model opus' },
      { name: 'token-efficiency', desc: 'Unified CLI for all token optimization tools — tracks context size, costs, and efficiency.', example: 'python token-efficiency/efficiency-cli.py report' },
    ]
  },
  {
    title: 'Intelligence & Discovery',
    icon: Search,
    tools: [
      { name: 'relationship-tracker', desc: 'Mini-CRM for tracking contacts, interactions, follow-ups, and opportunity pipelines.', example: 'python relationship-tracker/tracker.py due' },
      { name: 'error-logger', desc: 'Identifies recurring failure patterns in agent execution logs.', example: 'python error-logger/errors.py analyze' },
      { name: 'communication-analytics', desc: 'Logs which message styles and tones get the best responses so agents can learn from patterns.', example: 'python communication-analytics/comms.py patterns' },
      { name: 'user-context', desc: 'Records personal preferences, mood, and working style observations in a local-only SQLite database.', example: 'python user-context/user_context.py summary' },
    ]
  }
];

export default function ToolkitPage() {
  const totalTools = toolCategories.reduce((sum, cat) => sum + cat.tools.length, 0);

  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      {/* Navbar */}
      <PublicNavbar />

      <main className="pt-28 pb-20 px-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Link href="/" className="p-2 rounded-lg bg-surface-tertiary hover:bg-surface-elevated text-text-secondary hover:text-text-primary transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Agent Toolkit</h1>
            <p className="text-text-secondary mt-1">{totalTools}+ Python CLI tools for local agent operations and state management.</p>
          </div>
        </div>

        {/* Governance bridge note */}
        <div className="mb-12 p-5 rounded-xl bg-brand/5 border border-brand/20">
          <div className="flex items-start gap-3">
            <RefreshCw size={18} className="text-brand mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-text-secondary leading-relaxed">
                Each tool runs locally and stores data in a private SQLite database under its own subdirectory. To push data to your DashClaw governance dashboard, add <code className="text-brand font-mono text-xs bg-brand/10 px-1.5 py-0.5 rounded">--push</code> to any write command, or run <code className="text-brand font-mono text-xs bg-brand/10 px-1.5 py-0.5 rounded">python sync_to_dashclaw.py</code> from inside the installed workspace&apos;s <code className="text-text-secondary font-mono text-xs">tools/</code> directory to bulk-sync all categories. Sync uses <code className="text-text-secondary font-mono text-xs">DASHCLAW_BASE_URL</code> and <code className="text-text-secondary font-mono text-xs">DASHCLAW_API_KEY</code> from your environment (or <code className="text-text-secondary font-mono text-xs">secrets/dashclaw.env</code> alongside the tools). The commands shown on each tool below are written to run from that <code className="text-text-secondary font-mono text-xs">tools/</code> directory.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-16">
          {toolCategories.map((cat) => {
            const CategoryIcon = cat.icon;
            return (
              <section key={cat.title}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-lg bg-brand/10 flex items-center justify-center">
                    <CategoryIcon size={20} className="text-brand" />
                  </div>
                  <h2 className="text-xl font-semibold">{cat.title}</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {cat.tools.map((tool) => (
                    <div key={tool.name} className="p-5 rounded-xl bg-surface-secondary border border-border hover:border-brand/30 transition-all group">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-base font-semibold text-text-primary group-hover:text-brand transition-colors">{tool.name}</h3>
                        <span className="px-2 py-0.5 rounded text-[10px] bg-surface-tertiary text-text-secondary font-mono">CLI</span>
                      </div>
                      <p className="text-sm text-text-secondary leading-relaxed mb-4">{tool.desc}</p>
                      <div className="bg-surface-primary rounded-lg px-3 py-2 border border-border">
                        <code className="text-xs text-text-tertiary font-mono">{tool.example}</code>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {/* Install CTA */}
        <div className="mt-20 p-8 rounded-2xl bg-gradient-to-br from-[#111] to-[#0a0a0a] border border-brand/20">
          <h2 className="text-2xl font-bold mb-2">Install the toolkit</h2>
          <p className="text-text-secondary mb-6 max-w-2xl">Three steps: clone the DashClaw repo, run the installer (it prompts for a workspace path and copies the tools there), then <code className="font-mono text-xs text-text-primary bg-surface-secondary px-1.5 py-0.5 rounded border border-border">cd</code> into that workspace&apos;s <code className="font-mono text-xs text-text-primary bg-surface-secondary px-1.5 py-0.5 rounded border border-border">tools/</code> directory to run any command on this page.</p>

          <div className="mb-6">
            <p className="text-xs text-text-tertiary font-mono mb-2">1. Clone the repo (skip if you already have it)</p>
            <div className="bg-surface-primary rounded-lg px-4 py-3 border border-border">
              <code className="text-xs text-text-secondary font-mono">git clone https://github.com/ucsandman/DashClaw.git && cd DashClaw</code>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div>
              <p className="text-xs text-text-tertiary font-mono mb-2">2. Mac / Linux installer</p>
              <div className="bg-surface-primary rounded-lg px-4 py-3 border border-border">
                <code className="text-xs text-text-secondary font-mono">bash ./agent-tools/install-mac.sh</code>
              </div>
              <p className="text-[11px] text-text-tertiary mt-1.5 leading-relaxed">Prompts for a workspace path (default <code className="font-mono">~/dashclaw</code>) and copies the bundle to <code className="font-mono">$workspace/tools/</code>.</p>
            </div>
            <div>
              <p className="text-xs text-text-tertiary font-mono mb-2">2. Windows (PowerShell) installer</p>
              <div className="bg-surface-primary rounded-lg px-4 py-3 border border-border">
                <code className="text-xs text-text-secondary font-mono">powershell -ExecutionPolicy Bypass -File .\agent-tools\install-windows.ps1</code>
              </div>
              <p className="text-[11px] text-text-tertiary mt-1.5 leading-relaxed">Default workspace is <code className="font-mono">%USERPROFILE%\dashclaw</code>. Bundle copies to <code className="font-mono">$workspace\tools\</code>.</p>
            </div>
          </div>

          <div className="mb-6">
            <p className="text-xs text-text-tertiary font-mono mb-2">3. Move into the workspace and run anything</p>
            <div className="bg-surface-primary rounded-lg px-4 py-3 border border-border space-y-1">
              <div><code className="text-xs text-text-secondary font-mono">cd ~/dashclaw/tools</code><span className="text-text-disabled text-xs font-mono ml-2"># or %USERPROFILE%\dashclaw\tools on Windows</span></div>
              <div><code className="text-xs text-text-secondary font-mono">python relationship-tracker/tracker.py due</code><span className="text-text-disabled text-xs font-mono ml-2"># any tool example from this page</span></div>
            </div>
          </div>

          <div className="mb-6">
            <p className="text-xs text-text-tertiary font-mono mb-2">Optional: bulk-sync all local data to your DashClaw instance</p>
            <div className="bg-surface-primary rounded-lg px-4 py-3 border border-brand/10 space-y-1">
              <div><code className="text-xs text-brand font-mono">python sync_to_dashclaw.py --dry-run</code><span className="text-text-disabled text-xs font-mono ml-2"># preview only, also run from ~/dashclaw/tools/</span></div>
              <div><code className="text-xs text-brand font-mono">python sync_to_dashclaw.py</code><span className="text-text-disabled text-xs font-mono ml-2"># actually push, requires DASHCLAW_BASE_URL + DASHCLAW_API_KEY in env</span></div>
            </div>
            <p className="text-[11px] text-text-tertiary mt-1.5 leading-relaxed">Both commands are run from the <code className="font-mono">tools/</code> directory the installer created (e.g. <code className="font-mono">~/dashclaw/tools/</code>), where <code className="font-mono">sync_to_dashclaw.py</code> lives alongside every tool&apos;s subdirectory.</p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4">
            <Link href="/docs" className="px-6 py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors">
              View SDK Docs
            </Link>
            <a href="https://github.com/ucsandman/DashClaw" target="_blank" rel="noopener noreferrer" className="px-6 py-2.5 rounded-lg bg-surface-tertiary text-text-primary text-sm font-medium hover:bg-surface-elevated transition-colors inline-flex items-center gap-2">
              <GithubIcon size={16} /> Star on GitHub
            </a>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
