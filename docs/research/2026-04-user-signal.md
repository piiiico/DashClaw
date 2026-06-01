# DashClaw User Signal Report

**Date:** 2026-04-11
**Method:** Mined GitHub issues, discussions, forks with real commit activity, and owner commit history for positioning signals. No direct user outreach yet.
**Purpose:** Ground the "what to build next" decision in evidence instead of guessing.

---

## Headline Finding

**DashClaw's real users are the homelab / self-host crowd, not enterprise security teams.** The code, the commits, the bug reports, and the surviving forks all point in the same direction — and the current "governance runtime for AI agent decisions" framing speaks to a completely different audience than the one actually showing up.

This is a **positioning drift**, not a product drift. The capabilities are good. The wrapper is wrong.

---

## Vanity vs. Real Traction

| Metric | Raw | What it actually means |
|---|---|---|
| Stars | 207 | Decent discovery, *slightly* above average curiosity |
| Watchers | 4 | ~2% watch rate — far below the ~5–10% healthy floor. People find it, nobody subscribes |
| Forks | 42 | **Vanity metric.** Only ~7 forks (~17%) have real commits. The other 35 are passive clones |
| Real-activity forks | 7 | Actual "someone tried to build with this" signal |
| Persistent-user forks | ~4 | Forks where the same person kept shipping code for multiple days |
| Open issues | 1 | `/mobile` — filed by Wes himself |
| Closed issues | ~5 | All from a tiny handful of real users |
| Discussions | 0 | `hasDiscussionsEnabled: true`, zero content |

**Takeaway:** Real user count is in the single digits. The fork count is inflating the perceived audience by ~6x.

---

## Who's Actually Using DashClaw

Four real users emerged from the data. I'm including what they did, in their own commits/messages, because this is the whole story.

### 1. Lief (`RyanTJoy/DashClaw`) — Self-hoster on LAN

Commits Lief pushed to their fork (not Wes's commits):

- `fa268c3` *"fix: skip upgrade-insecure-requests and HSTS on plain HTTP self-hosted instances"*
  > "The CSP directives `upgrade-insecure-requests` and `block-all-mixed-content` plus the HSTS header cause browsers to silently upgrade all fetches to HTTPS. **On LAN instances running plain HTTP (e.g. http://192.168.x.x:3000), this breaks every client-side fetch — useSession() never resolves, login page renders a white screen.**"
- `108be08` *"fix: make local auth cookie Secure flag conditional on HTTPS"*
  > "On self-hosted LAN instances running plain HTTP, browsers silently drop Secure cookies, making local password login appear broken."
- `49c8ae3` *"fix: cookie auth for API routes + hard redirect after local login"*
  > "Mobile browsers and hard navigates may not send this header, causing 401s despite valid cookies."

**What this tells us:** Lief was running DashClaw at `http://192.168.x.x:3000` on their own hardware. They hit multiple blocking bugs, debugged the root cause, wrote clean fixes, and pushed to their fork. Senior-engineer-level work on a product they clearly wanted to use on their homelab.

**They never opened a PR.** The fork is their fork, and they just kept it working for themselves. Classic homelab dev behavior.

### 2. Elpolini (`elpolini/DashClaw`) — Self-host compatibility hardener

Real commits by "Elpolini" (not synced from upstream):

- `dbf5463` *"feat(compat): harden self-host + legacy schema migrations"*
- `dfcf560` *"chore(paths): decouple docs/prompts paths via env overrides"*
- `072350e` *"chore(lockfile): sync package metadata to v1.9.0"*
- `5c4d90a` *"feat(bootstrap): enrich sync payload and diagnostics"*

**What this tells us:** Someone upgrading DashClaw on a self-hosted instance from an older schema, frustrated enough that they wrote compat shims and env overrides so their deploy wouldn't break. They cared about `docs/prompts` paths being configurable — meaning they're running DashClaw in an unusual layout, probably alongside other services.

### 3. Jory Irving (`joryirving`) — Authentik user filed 2 issues

- Issue #18: *"Feature Request: Add Authentik OIDC Support"* — Wes shipped it the same day
- Issue #26: *"Bug: OIDC provider constructs wrong authorization URL with Authentik"* — Wes fixed it next day

**What this tells us:** Jory runs [Authentik](https://goauthentik.io/), a self-hosted OIDC provider beloved by the homelab community. They wanted DashClaw to plug into their existing self-hosted auth infrastructure. They cared enough to file two issues and stick through a bug. **This is the classic homelab-stack workflow: bring your own auth, wire everything together, run it all on your own hardware.**

### 4. Jasmeet Sidhu (`jsidhu`) — Upstream contributor

Merged PR #21: *"fix: resolve crypto TDZ error in local auth route"*

> "const crypto = await import('node:crypto') on line 40 shadowed the global crypto, causing a ReferenceError on line 28..."

**What this tells us:** Jasmeet cared enough about the local-auth path to send a real upstream PR. They were running DashClaw locally. Same pattern.

### Lower-signal but consistent

- **Ahlyx (#46)** — found DashClaw through a *secret scanner they were building*, not through marketing. Discovery was ambient, not driven. Mentioned building against "Hermes agent" and "OpenClaw". **They never used DashClaw.**
- **krimsonzcv-rgb (#71)** — cloned locally on 2026-04-07, hit a `lucide-react` build error two hours later, filed an issue. Classic activation friction. No follow-up.
- **Robocular/Ozor (#31)** — wanted to integrate DashClaw with "40+ AI agent services", opened an issue. Wes's own reply: *"tried looking at the site but it looks like the get API key doesn't work and I got a 502 on the docs"*. The activation path was literally broken on the day the user tried it.
- **EthanThePhoenix38/DashClaw-Security** — renamed their fork to include "Security", tracked upstream for ~12 days, but never committed original code. They **watched** instead of **built**. Smallest-useful signal that the security framing *does* attract some niche interest.

---

## What Wes Himself Shipped in Response to Users

Ordered by commit date, on the upstream `main` branch:

- `5c74dd6` *"feat: implement local admin password authentication so OAuth is optional"* (2026-02-20)
- `55004a5` *"docs: update marketing site and documentation to highlight local password auth as the primary path"* (2026-02-20)
- `0cf87fb` *"docs: reflect that OAuth is now optional and highlight admin password feature"* (2026-02-20)
- OIDC / Authentik support (fix for issue #26, 2026-02-24)
- `6bd4b6b` *"feat(self-host): prioritize download skill CTA in get started"* (2026-02-25)
- `44089a5` *"test+docs: add route unit coverage and no-oauth deploy guide"* (2026-02-25)

**Pattern:** Every user-driven feature Wes shipped in February was about making the **self-host / local-auth / no-OAuth / LAN-friendly** path work. The product is already organically drifting toward a self-host-first shape. The marketing/docs/homepage haven't caught up.

---

## The Positioning Drift, Stated Plainly

| What DashClaw says it is | What the real users treat it as |
|---|---|
| *"Decision infrastructure for AI agents. Intercept actions, enforce guard policies, require approvals, and produce audit-ready decision trails."* | *"A control plane for the AI agents I'm running on my own hardware."* |
| Speaks to: compliance, audit, procurement, enterprise governance | Speaks to: homelab, self-host, Tailscale, Authentik, LAN infra, Claude running at home |
| Audience: SOC2-conscious engineering orgs (slow, procurement cycles, big sales motion) | Audience: hobbyist + pro devs running agents on their own boxes (fast, word-of-mouth, community-driven) |
| Framing friction: "Do I *really* need governance for my side project?" | Framing pull: "Oh shit, I can finally see what my background Claude is doing on my NAS?" |

The original vision Wes stated — *"everyone will have AI agents doing things for them constantly, we'll need a way to manage them"* — is **much closer to the second column** than the first.

---

## What's Working (and we didn't know it)

1. **Local password auth** — shipped in response to users, made OAuth optional. Self-host-friendly.
2. **Vercel 1-click deploy** — free-tier, zero-friction. Already matches "easy for solo devs".
3. **Docker alternative deploy path** — exists, per the STACK.md mapping.
4. **Authentik OIDC support** — shipped within a day of the request. Homelab auth is a first-class concern.
5. **MCP server at `/api/mcp`** — lets Claude Desktop / Claude Code / local agents talk to DashClaw directly. **This is the homelab superpower and nobody's marketing it that way.**

## What's Broken (and is actively losing users)

1. **Activation friction is documented in the data.** `lucide-react` build error (#71), 502 on docs (#31), CSP/HSTS breaking LAN login (Lief's fork), cookie Secure flag on plain HTTP (Lief's fork), schema migrations breaking upgrades (Elpolini's fork). All of these are *landing-page-to-working-instance* friction, and every one of them tripped a real user.
2. **Mobile experience** — Wes himself flagged this (#60). Self-hosters check their dashboards from phones.
3. **No user reached out twice.** Nobody came back with a second issue saying "I've been using this for a month, here's what I want next." There is no retention signal, which means we don't know if the ones who got it working stayed.

---

## Ecosystem Signals (lightly weighted)

Repo topics include `openclaw` and `hermes`. Ahlyx mentioned "Hermes agent" and "OpenClaw" casually in a comment, as though they're adjacent projects in the same mental neighborhood. If DashClaw is part of an ecosystem Wes is building or plugging into, that's a distribution lever we haven't touched. **(This is the main thing I don't yet know and should ask Wes about directly.)**

---

## What This Means for "What to Build Next"

Four directions, ordered by leverage and evidence:

### A. Reposition around self-host / homelab. **(Highest leverage, lowest cost.)**
No code changes. Rewrite the README, dashclaw.io homepage, and `/connect` onboarding to speak to "I run Plex, Authentik, Tailscale — now I want Claude on my own hardware with guardrails." Distribute to r/selfhosted, r/homelab, Awesome-Selfhosted list, Authentik Discord, Unraid and TrueNAS communities. Hook Claude Desktop / Claude Code people in via the existing MCP server.
- **Effort:** days of copy/asset work, no code
- **Risk:** positioning miss (if Wes doesn't actually *believe* this, it'll feel hollow)
- **Evidence backing it:** Every real user we found is in this audience

### B. Talk to the 4 real users. **(Highest information value, near-zero cost.)**
Email/DM Lief, Elpolini, Jory Irving, Jasmeet Sidhu. Say thanks for the commit/issue, ask: "What are you actually using DashClaw for? What's the first thing you wish it did better? Can I interview you for 15 minutes?" 1–2 of them will say yes. Their answers reshape everything.
- **Effort:** 30 minutes to draft and send
- **Risk:** none, except the mild ick of reaching out cold
- **Evidence backing it:** We have zero repeat-user signal and cannot roadmap without this

### C. Harden the self-host path. **(Reinforces A and B.)**
Build on Lief + Elpolini + Jory's bug fixes. Make Docker Compose the first-class deploy (not Vercel). Bake in Lief's CSP/cookie fixes for plain-HTTP LAN. Make Authentik/OIDC setup a documented happy path. Fix the `lucide-react` build error. Add a local-tunnel setup for mobile (Tailscale funnel, Cloudflare tunnel, or just "we explain how to use yours").
- **Effort:** 1–2 weeks of focused code work
- **Risk:** wasted effort if we don't validate positioning first
- **Evidence backing it:** the commits and issues are literally the feature spec

### D. Fix the onboarding activation moment. **(Cuts bounce rate for everyone.)**
The 502 on docs, the lucide build error, and the bootstrap DB migration churn are killing new users before the Aha. Orthogonal to positioning — this helps regardless of direction.
- **Effort:** ~1 week, well-scoped tasks
- **Risk:** doesn't answer the positioning question, just plugs the leaky bucket
- **Evidence backing it:** hard evidence in #31, #71, Elpolini's migration commits

**My recommendation, based purely on what the data supports:**

> **Do B first (it's free and fast). Let what you hear shape A (the positioning rewrite). Then C and D in parallel.** Do not start with C or D alone — you'll build the right thing for the wrong audience and bounce off again.

---

## Open questions for Wes (for the conversation, not for SIGNAL.md to answer)

1. Do *you* actually run DashClaw on your own hardware, or only on Vercel? If the answer is "only Vercel," the self-host pivot is harder because you're not eating your own dogfood.
2. What are Hermes and OpenClaw? Are they yours? Part of a broader ecosystem? Because that changes the distribution play substantially.
3. Does the "self-hosted mission control for your AI agents" framing *feel true* to you, or does it feel like abandoning the original vision? (If it feels wrong, we need to find a different frame — positioning that the founder doesn't believe is dead on arrival.)
4. Are you willing to reach out to the 4 users identified above?
5. What does "take off" actually look like in your head — a specific number, a logo, a community, a revenue target?
