import Link from 'next/link';
import {
  ChevronRight,
  ShieldCheck,
  KeyRound,
  Package,
  Plug,
  Terminal,
  Smartphone,
  MessageSquare,
  Send,
  Bot,
  Code,
  ArrowRight,
} from 'lucide-react';

import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';

/*
 * Framework agnostic /connect runbook.
 *
 * This page assumes the visitor already has a running DashClaw instance
 * (or links them back to /self-host if they do not). The single job of
 * this page is to get an agent talking to that instance with an
 * approval surface configured.
 *
 * Structure:
 *   1. Get your API key            (env exports)
 *   2. Pick an integration surface (4 cards: SDK, MCP, Claude Code Hooks, OpenClaw)
 *   3. Pick an approval surface    (5 cards: Dashboard default, CLI, Mobile PWA, Discord, Telegram)
 *   4. Verify                       (1 consolidated Verify section)
 *   Framework guides                (5 cards: Claude Code, OpenAI Agents SDK, LangGraph, CrewAI, OpenClaw)
 */

export const metadata = {
  title: 'Connect an agent to DashClaw',
  description:
    'Point any agent at your running DashClaw instance. Pick an integration surface, configure approvals, verify with one command.',
  openGraph: {
    title: 'Connect an agent to DashClaw',
    description:
      'Point any agent at your running DashClaw instance. Pick an integration surface, configure approvals, verify with one command.',
  },
};

function StepHeader({ n, children }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="w-7 h-7 rounded-full bg-brand-subtle border border-border-active text-brand text-xs font-bold flex items-center justify-center">
        {n}
      </span>
      <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-text-primary">
        {children}
      </h2>
    </div>
  );
}

function CodeBlock({ children }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-border bg-surface-primary p-4 text-xs leading-relaxed text-text-secondary font-mono">
      {children}
    </pre>
  );
}

function Eyebrow({ children }) {
  return (
    <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-text-tertiary mb-3">
      {children}
    </p>
  );
}

export default function ConnectPage() {
  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      <PublicNavbar />

      <main className="px-6 pb-20 pt-28">
        <div className="mx-auto max-w-5xl">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="mb-8 flex items-center gap-2 text-sm text-text-tertiary">
            <Link href="/" className="transition-colors hover:text-text-secondary">
              Home
            </Link>
            <ChevronRight size={14} aria-hidden="true" />
            <span className="text-text-secondary">Connect an Agent</span>
          </nav>

          {/* Hero */}
          <header className="mb-10">
            <Eyebrow>Connect an agent</Eyebrow>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-tight text-text-primary">
              Point your agent at your running DashClaw instance.
            </h1>
            <p className="mt-5 text-lg text-text-secondary max-w-2xl leading-relaxed">
              Pick an integration surface, configure an approval surface, verify with one command. Works with any agent framework that can call an HTTP API or an SDK.
            </p>

            {/* Prerequisite band */}
            <div className="mt-8 rounded-2xl border border-border-active bg-brand-subtle/40 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-brand-subtle border border-border-active flex items-center justify-center shrink-0">
                    <ShieldCheck size={18} className="text-brand" aria-hidden="true" />
                  </div>
                  <p className="text-sm text-text-secondary leading-relaxed">
                    <span className="font-semibold text-text-primary">Before you start, you need a running DashClaw instance.</span>{' '}
                    If you do not have one yet, stand it up first. Takes about 10 minutes on Vercel and Neon free tiers.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                  <Link
                    href="/self-host"
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-white text-sm font-bold hover:bg-brand-hover transition-colors"
                  >
                    Self host the runtime <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                  <Link
                    href="/#live-demo"
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-surface-secondary border border-border text-text-secondary text-sm font-medium hover:border-border-hover hover:text-text-primary transition-colors"
                  >
                    Explore the live demo <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>

            <p className="mt-5 text-sm text-text-tertiary italic max-w-2xl">
              First connection takes 5 to 15 minutes depending on the integration surface you pick.
            </p>
          </header>

          {/* Step 1: API key */}
          <section className="mt-10 rounded-2xl border border-border bg-surface-secondary p-6 sm:p-8">
            <StepHeader n={1}>Get your API key</StepHeader>
            <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
              From your DashClaw instance settings, copy your API key. It starts with{' '}
              <code className="rounded border border-border bg-surface-primary px-1 py-0.5 font-mono text-[12px] text-text-secondary">oc_live_</code>{' '}
              for self hosted instances. Export it alongside your instance URL:
            </p>
            <div className="mt-4">
              <CodeBlock>{`export DASHCLAW_BASE_URL=https://your-instance.vercel.app
export DASHCLAW_API_KEY=oc_live_...`}</CodeBlock>
            </div>
            <p className="mt-4 text-xs text-text-tertiary leading-relaxed max-w-2xl">
              Never use{' '}
              <code className="rounded border border-border bg-surface-primary px-1 py-0.5 font-mono text-[11px] text-text-secondary">https://dashclaw.io</code>{' '}
              as your agent base URL. Point at your own instance. The dashclaw.io deployment runs in demo mode and rejects writes.
            </p>
          </section>

          {/* Step 2: Integration surface */}
          <section className="mt-6 rounded-2xl border border-border bg-surface-secondary p-6 sm:p-8">
            <StepHeader n={2}>Pick an integration surface</StepHeader>
            <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
              Four ways to plug an agent into DashClaw. Pick one. All four hit the same governance loop on the same instance, so you can switch later without changing anything else.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* SDK */}
              <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <Package size={16} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">SDK</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Node.js or Python. Wrap risky actions in <code className="font-mono text-text-primary">claw.guard()</code> and you are done.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`# Node
npm install dashclaw

# Python
pip install dashclaw`}</CodeBlock>
                  <Link href="/docs" className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-hover transition-colors font-medium">
                    Full SDK docs <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </div>

              {/* MCP Server */}
              <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <Plug size={16} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">MCP Server</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Zero code. Any MCP compatible client (Claude Code, Claude Desktop, Claude Managed Agents) gets governance through one config block.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`npx @dashclaw/mcp-server \\
  --url $DASHCLAW_BASE_URL \\
  --key $DASHCLAW_API_KEY`}</CodeBlock>
                  <Link href="/docs#mcp-server" className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-hover transition-colors font-medium">
                    MCP server docs <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </div>

              {/* Claude Code Hooks */}
              <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <Code size={16} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">Claude Code Hooks</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Two Python files dropped into{' '}
                  <code className="font-mono text-text-primary">.claude/hooks/</code>. Governs Bash, Edit, Write, and MultiEdit tool calls. Safe to ship even without DashClaw configured.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`cp hooks/dashclaw_*.py .claude/hooks/`}</CodeBlock>
                  <Link href="/guides/claude-code" className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-hover transition-colors font-medium">
                    Claude Code guide <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </div>

              {/* OpenClaw Plugin */}
              <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <Bot size={16} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">OpenClaw Plugin</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Framework native plugin for OpenClaw agents. Intercepts PreToolUse and PostToolUse, runs guard, records the outcome, and waits for approval automatically.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`npm install @dashclaw/openclaw-plugin`}</CodeBlock>
                  <Link href="/guides/openclaw" className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-hover transition-colors font-medium">
                    OpenClaw plugin guide <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>
          </section>

          {/* Step 3: Approval surface */}
          <section className="mt-6 rounded-2xl border border-border bg-surface-secondary p-6 sm:p-8">
            <StepHeader n={3}>Pick an approval surface</StepHeader>
            <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
              When guard returns{' '}
              <code className="font-mono text-text-primary">require_approval</code>, the action pauses until a human resolves it. Pick where humans should see and resolve those approvals. Dashboard is on by default. The other four are optional and additive.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {/* Dashboard (default) */}
              <div className="rounded-xl border border-border-active bg-brand-subtle/20 p-5 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={16} className="text-brand" aria-hidden="true" />
                    <h3 className="text-base font-semibold text-text-primary">Dashboard</h3>
                  </div>
                  <span className="rounded-md border border-border-active bg-brand-subtle px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand">
                    Default
                  </span>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Always on. Interactive queue with triggering policy, risk score, and replay link.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`https://<your-instance>/approvals`}</CodeBlock>
                </div>
              </div>

              {/* CLI */}
              <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <Terminal size={16} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">CLI</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  For terminal first developers.{' '}
                  <code className="font-mono text-text-primary">dashclaw approve</code> and{' '}
                  <code className="font-mono text-text-primary">dashclaw deny</code> against the same governance endpoint.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`npm install -g @dashclaw/cli
dashclaw approvals`}</CodeBlock>
                </div>
              </div>

              {/* Mobile PWA */}
              <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <Smartphone size={16} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">Mobile PWA</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Add <code className="font-mono text-text-primary">/approve</code> to your home screen on iOS or Android. One tap Allow or Deny from the phone. SSE driven, updates within about one second.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`https://<your-instance>/approve`}</CodeBlock>
                </div>
              </div>

              {/* Discord */}
              <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare size={16} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">Discord bot</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Phone first via DM. Inline Approve and Deny buttons in a registered user DM. Fire and forget; action creation succeeds even if Discord is unreachable.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`DISCORD_BOT_TOKEN=<token>
DISCORD_APPROVER_USER_ID=<user-id>
DISCORD_APPROVER_ORG_ID=<org-id>`}</CodeBlock>
                  <Link href="/self-host#approve-from-anywhere" className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-hover transition-colors font-medium">
                    Discord bot setup guide <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </div>

              {/* Telegram */}
              <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <Send size={16} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">Telegram bot</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Inline Approve and Deny buttons pushed to an admin chat. Warns and moves on if Telegram is unreachable.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`npm run telegram:setup`}</CodeBlock>
                  <Link href="/self-host#approve-from-anywhere" className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-hover transition-colors font-medium">
                    Telegram setup guide <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>
          </section>

          {/* Step 4: Verify */}
          <section className="mt-6 rounded-2xl border border-border bg-surface-secondary p-6 sm:p-8">
            <StepHeader n={4}>Verify</StepHeader>
            <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
              Run{' '}
              <code className="font-mono text-text-primary">dashclaw doctor</code>{' '}
              from any terminal. Exit 0 means the instance is healthy and your SDK or surface is reachable. Then have your agent attempt a low risk action and watch it land in the dashboard inbox.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface-tertiary p-5">
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary mb-2">From any terminal</div>
                <h3 className="text-sm font-semibold text-text-primary mb-2">dashclaw doctor</h3>
                <p className="text-xs text-text-secondary leading-relaxed mb-3">
                  Diagnoses database, configuration, auth, deployment, SDK reachability, governance staleness, and shape drift. Auto fixes safe issues.
                </p>
                <CodeBlock>{`npm install -g @dashclaw/cli
dashclaw doctor`}</CodeBlock>
              </div>
              <div className="rounded-xl border border-border bg-surface-tertiary p-5">
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary mb-2">Self host operator</div>
                <h3 className="text-sm font-semibold text-text-primary mb-2">npm run doctor</h3>
                <p className="text-xs text-text-secondary leading-relaxed mb-3">
                  Adds filesystem level fixes (env writes, migrations, default policy seed). Backs up{' '}
                  <code className="font-mono text-text-primary">.env</code>{' '}
                  before any write.
                </p>
                <CodeBlock>{`npm run doctor`}</CodeBlock>
              </div>
            </div>

            <p className="mt-4 text-[11px] text-text-tertiary leading-relaxed">
              Exit codes: <code className="font-mono text-text-secondary">0</code> healthy,{' '}
              <code className="font-mono text-text-secondary">1</code> warnings or unreachable. Add{' '}
              <code className="font-mono text-text-secondary">--json</code> for CI integration.
            </p>
          </section>

          {/* Framework guides */}
          <section className="mt-10 rounded-2xl border border-border bg-surface-secondary p-6 sm:p-8">
            <Eyebrow>Framework guides</Eyebrow>
            <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
              Step by step walkthroughs for popular frameworks
            </h2>
            <p className="mt-3 text-sm text-text-secondary max-w-2xl leading-relaxed">
              Deeper walkthroughs once you have picked a surface in Step 2. Each takes 10 to 20 minutes end to end.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  href: '/guides/claude-code',
                  title: 'Claude Code',
                  desc: 'Govern Bash, Edit, Write, and MultiEdit tool calls via PreToolUse hooks. Zero SDK code required.',
                },
                {
                  href: '/guides/openai-agents-sdk',
                  title: 'OpenAI Agents SDK',
                  desc: 'Add guard, record, and outcome governance to your OpenAI agent tools with the Node.js SDK.',
                },
                {
                  href: '/guides/langgraph',
                  title: 'LangGraph',
                  desc: 'Add a governance node to your LangGraph StateGraph with the Python SDK. Includes a runnable example.',
                },
                {
                  href: '/guides/crewai',
                  title: 'CrewAI',
                  desc: 'Govern CrewAI tool calls using the @tool decorator pattern with the Python SDK. Includes a runnable example.',
                },
                {
                  href: '/guides/openclaw',
                  title: 'OpenClaw',
                  desc: 'Framework native plugin. Intercepts PreToolUse and PostToolUse and calls guard, record, and waitForApproval automatically.',
                },
              ].map((g) => (
                <Link
                  key={g.href}
                  href={g.href}
                  className="group rounded-xl border border-border bg-surface-tertiary p-5 transition-colors hover:border-border-active"
                >
                  <h3 className="text-base font-semibold text-text-primary transition-colors group-hover:text-brand">
                    {g.title}
                  </h3>
                  <p className="mt-2 text-sm text-text-secondary leading-relaxed">{g.desc}</p>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
