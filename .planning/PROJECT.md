# DashClaw

## What This Is

DashClaw is the approval, audit, and policy layer that sits in front of your coding agent (Claude Code first, then Cursor/Aider/Cody) so it can never run something destructive without your say-so, and you always have a clean trail of exactly what it did. The beachhead is AI-first developers who use Claude Code daily and want remote approvals, policy rules, and a real audit log for their agent — not a compliance product for enterprises, and not a homelab tool for self-hosters.

## Core Value

**Your coding agent can never surprise you with a destructive action, and you can always prove what it did.** If everything else DashClaw does fails, this one thing must work: a developer running Claude Code feels safer with DashClaw in front of it than without it, and can demonstrate to themselves (or a teammate) exactly what the agent touched.

## Requirements

### Validated

<!--
Brownfield baseline: the runtime below has shipped and is running at v2 — but user validation is weak for most of it, which is exactly the problem we're solving. These items are "infrastructure present, relied upon by the few real users we have" — NOT "proved valuable at scale." Treat as the foundation we keep, not features we're proud of.
-->

- Core governance loop (guard → policy eval → record → stream) shipped in v2 runtime
- `/mission-control`, `/decisions`, `/setup`, `/connect` surfaces exist and function
- v2 SDK with 45 methods (Node + Python), MCP server at `/api/mcp`
- Repository pattern enforced (no direct SQL in routes), route SQL guardrail wired
- Multi-LLM support with lazy-loading (OpenAI, Anthropic, Gemini)
- Messaging adapters: Slack, Discord, GitHub, Linear, Resend, SendGrid
- Local admin password auth + OIDC + NextAuth (OAuth optional)
- Vercel 1-click deploy + Docker alternative, both working
- Next.js 16 App Router, Postgres (Neon), Drizzle ORM, Vitest testing
- Founder-private dogfood: Wes has Claude Code pinging him on Discord for command approvals (from issue #46 comment, 2026-03-18) — **works, but is not publicized or demoed**

### Active

<!-- Beachhead scope. These are hypotheses until real Claude Code users are on them. -->

- [ ] **Claude Code first-class integration.** A documented, 5-minute "put DashClaw in front of Claude Code" path. Install, wire up, first approval in under 5 minutes. The success metric is a video where Wes does it end-to-end on a fresh machine
- [ ] **Public dogfood: Wes's own Claude Code → Discord approval flow turned into the flagship demo.** Video, tweet thread, blog post, README hero section, homepage rewrite. The demo IS the marketing — and it's also the product
- [ ] **Policy rules for coding agents.** Allow git commits silently, always block `rm -rf` and mass file deletion, ask for network calls, log everything. A small, opinionated default policy pack that ships with the Claude Code integration
- [ ] **Remote approval via Discord (then Slack, then email/SMS).** Approve/deny from your phone in under 10 seconds while you're away from the terminal. Discord first because it's what Wes already uses
- [ ] **Audit trail UI for "what did my agent do today / this week."** A timeline of commands, file edits, approvals, denials — readable by humans, not just a decision ledger for auditors
- [ ] **Reach out to the 4 real users identified in `.planning/research/SIGNAL.md`** (Lief, Elpolini, Jory Irving, Jasmeet Sidhu). Thank them, ask what they're building, interview 1–2 of them. First-ever user research pass for DashClaw
- [ ] **Fix the activation-failure blockers from SIGNAL.md**: `lucide-react` build error (#71), 502 on docs (#31), CSP/HSTS breaking LAN login (from Lief's fork), migration churn (from Elpolini's fork). Plug the leaky bucket *in parallel* with building the beachhead — not before, not after
- [ ] **Closed-loop growth flywheel: DashClaw-governed AI agents that grow DashClaw.** A small research agent that scans HN/Twitter/Reddit/GitHub for Claude Code complaints and surfaces leads. A content agent that drafts developer-facing content. All running through DashClaw, all publicly visible, all part of the story
- [x] **Open source, no paid tier (2026-05-14):** DashClaw is a free open-source project for governing AI agents. The earlier "50-integration trigger" monetization commitment (formerly Plan 03-03 MON-01) was retracted along with the `/pricing` page, the public counter API, the monetization repository, the launch drafts, and the related tests. `requireTier()` in `app/lib/org.js` is preserved as a no-op shim so the seven routes that historically called it stay type-compatible without a sweep. If a future build re-introduces tiers, restore the original `{ free: 0, pro: 1 }` rank ladder and the 403 branch.
- [ ] **Expand beachhead to Cursor, Aider, Cody** after Claude Code path is proven (≥100 active Claude Code users on DashClaw). Same technical foundation, different onboarding doc

### Out of Scope

<!-- Every one of these was considered in the 2026-04-11 discovery session and rejected. Reasons included to prevent re-adding. -->

- **Homelab / self-host identity** — Rejected 2026-04-11. Real users *did* skew self-host (Lief, Elpolini, Jory, Jasmeet in `.planning/research/SIGNAL.md`), but founder does not resonate with the identity and would not evangelize it. Positioning the founder doesn't believe in is dead on arrival. We still *support* self-host technically (keep the Docker path, keep Lief's CSP fixes) but we don't *lead* with it
- **Enterprise security / compliance as the primary frame** — Rejected 2026-04-11. Sales motion unsuitable for solo indie dev. SOC2 / procurement cycles take quarters. We keep the audit-trail capability (it's useful for everyone) but we stop leading with compliance language
- **OpenClaw-specific positioning** — Rejected 2026-04-11. The `oc_` API key prefix and `OpenClawAgent = DashClaw` alias were naming homage (Wes liked Peter's "Claw"), not integration. OpenClaw community is 350k stars but founder views it as "one niche." We stay framework-agnostic; Claude Code is the beachhead because of distribution and dogfood, not because Claude Code is an identity
- **VC-scale growth** — Out of scope. Ambition is indie profitable, not rocket ship. Features and bets should be scoped to what one developer can ship, distribute, and support
- **Framework lock-in** (langchain-only, autogen-only, crewai-only) — Out of scope. Claude Code is the *first* integration, not the *only* one. Every architectural decision must leave the door open to Cursor, Aider, Cody, and custom agents
- **Paying for distribution** — Out of scope. No paid ads, no paid placements. Organic only: content, dogfood demos, AI-agent-driven outreach, community presence. This is a constraint born of budget but also of philosophy — the product IS the proof

## Context

- **Brownfield with scar tissue.** v2 runtime exists, governance loop works, 6+ months of code is in the repo. The code isn't the problem — positioning, distribution, and user research are. See `.planning/codebase/` for the full map.
- **Traction reality check.** 207 stars / 4 watchers / 42 forks → **~7 forks with real commits, ~4 persistent-user forks, ~1 open issue**. Single-digit real users. The gap between vanity metrics and real usage is exactly the problem this milestone exists to fix. Full signal analysis in `.planning/research/SIGNAL.md`.
- **Founder's dogfood is hiding.** The Claude Code → Discord approval flow is working (issue #46 comment, 2026-03-18), but it's never been demoed, tweeted, or featured on the homepage. The beachhead starts by bringing this into daylight.
- **Four real users to reach out to** (all in `.planning/research/SIGNAL.md`): Lief/RyanTJoy (LAN self-hoster who debugged CSP/HSTS issues and pushed fixes to their fork), Elpolini (self-host schema migration hardener), Jory Irving (Authentik homelab user), Jasmeet Sidhu (upstream PR contributor). None of them are the target audience, but all of them *actually used the product* and have information the target-audience dream users don't have yet.
- **Peer ecosystem.** OpenClaw (350k stars, unrelated but name-adjacent), Claude Code (Anthropic is actively pushing it, fast-growing), Cursor, Aider, Cody. The beachhead sits at the intersection of "developers running a coding agent daily" and "developers who've felt the pain of an agent doing something dumb."

## Constraints

- **Team**: Solo, nights-and-weekends transitioning toward part/full-time as revenue justifies. Every feature must be deliverable by one person
- **Budget**: Vercel free tier, Neon free tier — $0 OPEX floor. No paid infra, no paid ads
- **Tech stack**: Next.js 16 App Router, Node 20+, JavaScript (not TS), Postgres via Drizzle, Tailwind, Vitest, Turbopack. Repository pattern enforced; no direct SQL in routes
- **Deploy**: Vercel 1-click primary, Docker alternative — both must stay zero-friction. No "clone the repo and run migrations" steps for end users
- **Distribution**: Organic only. HN, Twitter, YouTube, AI engineer communities, content created partly by governed AI agents
- **Security**: No secrets in commits (global pre-commit guardrails active), route SQL guardrail, `.env` in gitignore
- **Compatibility**: Must support Claude Code's actual command/approval model (read their docs before designing the integration)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Target audience = devs running Claude Code / coding agents | Only working dogfood + only fast-growing distribution channel + solves a real felt pain ("my agent did something weird"). Vision-consistent with "the future wave of agent users" | — Pending (validated on evidence of real Claude Code users sticking) |
| Ambition = indie profitable dev-tool, not VC-scale | Founder's stated ambition 2026-04-11. Matches solo team size and nights/weekends bandwidth | ✓ Locked |
| Beachhead narrowing is TEMPORARY, not identity | Wes rejected every prior narrowing as an identity but explicitly accepted "narrow for a beachhead, then expand" | ✓ Locked |
| Free + open source, no paid tier | Retracted 2026-05-14: DashClaw is a tool for governing AI agents, not a SaaS funnel. The earlier "50-integration trigger" was the wrong frame — counter showed 0 indefinitely (marketing-site DB ≠ user instance DBs) and the apologetic "free while we grow" tone undersold an actually-free product. /pricing page, public counter, launch drafts, and trigger tests all removed. | ✓ Locked (2026-05-14) |
| Public dogfood is the flagship demo | Wes's Claude Code + Discord flow already works; it's hidden in a GitHub issue comment. Making it public costs near zero and creates immediate proof | ✓ Locked |
| Closed-loop flywheel: DashClaw-governed agents grow DashClaw | Founder's own idea; uniquely differentiated; meta-dogfood is both product and marketing proof. No other agent-governance tool can credibly do this | ✓ Locked (and I would put this front and center in the README) |
| Rejected: homelab / enterprise / OpenClaw positioning | All three rejected by founder 2026-04-11 — documented in Out of Scope with reasons | ✓ Locked |
| User research cadence = weekly minimum | Founder committed 2026-04-11. First 4 interview targets identified in SIGNAL.md | ✓ Locked |
| Activation bugs (#71, #31, Lief/Elpolini fixes) block launch | Can't demo the beachhead while new users hit a 502 on docs or a lucide build error. Must fix in parallel with beachhead work | ✓ Locked |

---
*Last updated: 2026-04-11 after discovery session (questioning + signal mining + direction-setting)*
