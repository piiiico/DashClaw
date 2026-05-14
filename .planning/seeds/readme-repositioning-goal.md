# DashClaw README Repositioning Goal

Paste this into Claude Code from `C:\Projects\DashClaw`.

```text
/goal Reposition and rewrite the DashClaw README so it presents DashClaw as broad AI-agent governance infrastructure, not as a Claude Code-only add-on.

Context:
Wes hates the current README. The concrete problem is not just polish. The README currently leads with "Govern Claude Code in 5 minutes" and old Claude Code-heavy screenshots, even though DashClaw works across many surfaces: MCP, SDKs, OpenAI agents, Anthropic/Claude Managed Agents, LangChain/LangGraph, CrewAI, AutoGen, Codex, Gemini CLI, OpenClaw, custom agents, webhooks, and direct API integrations.

Wes does not know exactly what he wants it to look like. Treat this as a positioning + information architecture pass first, then a README rewrite. Do not blindly rearrange copy. Decide what the README should make a new visitor believe in the first 30 seconds.

Primary objective:
Make the README answer this clearly:

DashClaw governs AI agents before they act. It sits between agents and external systems, checks policies, requires human approval when needed, records evidence, supports durable outcome finality, and works with many agent frameworks through MCP, SDKs, hooks, plugins, and APIs.

Important positioning shift:
- Claude Code is an excellent demo and one integration path.
- Claude Code is NOT the product identity.
- DashClaw is agent governance infrastructure.

Quality bar:
Flagship README. This is the front door for GitHub visitors. It should feel confident, current, technically credible, and broad without becoming vague enterprise soup.

Hard constraints:
- Do not commit, tag, push, deploy, publish, or contact anyone.
- Do not invent features DashClaw does not have.
- Do not fake metrics, users, testimonials, or adoption.
- Do not add pricing claims unless they match the current repo/docs.
- Avoid em dashes in README prose. Use commas, colons, or shorter sentences.
- Do not leave stale Claude Code-first framing in the hero.
- Do not remove Claude Code support. Reframe it as one path among several.
- Preserve useful existing install/deploy guidance, but reorder it around the new positioning.

Required inspection before editing:
1. Read current `README.md` fully.
2. Read `PROJECT_DETAILS.md` for the current platform framing and route/surface inventory.
3. Read `docs/architecture/durable-execution-finality.md` for the new v2.13.3 finality surface.
4. Inspect current screenshot assets under `public/images/screenshots/` and note which appear stale or mismatched with the current UI.
5. Inspect current package/version surfaces in `package.json`, `sdk/package.json` if present, `sdk-python`, `mcp-server`, `packages/openclaw-plugin`, and `public/downloads/*` enough to avoid lying about supported integrations.
6. Search the repo for current connection docs: MCP, SDK, Claude Code hooks, OpenClaw plugin, hosted deployment, connect page, quickstart.

Deliverables:

1. README strategy note, either as a short section in your final response or a temporary local note if helpful:
   - current problem
   - new hero promise
   - intended audience
   - recommended README order
   - what screenshots should be replaced, removed, or kept

2. Rewrite `README.md` with this target structure unless inspection suggests a clearly better one:

   A. Hero
   - Logo/title.
   - New primary tagline, for example: "Govern AI agents before they act."
   - One short paragraph explaining policy checks, approvals, audit evidence, durable outcomes, and external-system control.
   - A compact "works with" line grouped by integration type, not a random list.
   - Primary CTA: Deploy DashClaw / Try demo / Connect an agent.

   B. What DashClaw does
   - Intercept risky actions before execution.
   - Enforce policies.
   - Route approvals to humans.
   - Record audit evidence.
   - Track final outcomes and detect lost confirmations.
   - Govern tools, APIs, workflows, and external system calls.

   C. Choose your integration path
   Put Claude Code hooks here, not in the hero.
   Include paths such as:
   - MCP server for Claude Desktop, Claude Code, managed agents, and MCP-capable runtimes.
   - SDK for Node/Python/custom agents.
   - Claude Code hooks for coding-agent governance.
   - OpenClaw plugin.
   - Direct REST API/webhooks.
   - Skills/platform-intelligence bundle if still accurate.

   D. Quick start
   Keep it practical. Prefer a small universal quick start plus links to path-specific guides.
   If the existing `npm install` / `npm run hooks:install` only applies to Claude Code hooks, do not present it as the universal DashClaw install.

   E. Deploy/self-host
   Preserve Vercel/Neon deploy guidance if still accurate.
   Keep hosted trial mode optional and honest.

   F. Platform overview
   Use current surfaces and screenshots only. If screenshots are stale, either:
   - replace references with current screenshots if the repo already has better ones, or
   - mark a TODO in the README rewrite plan and remove the misleading old screenshot-heavy section from the top-level README, linking to docs instead.
   Do not keep old screenshots just because they exist.

   G. Durable execution finality / v2.13.3 highlight
   Add a concise feature section for the just-shipped durable finality surface:
   - one-shot terminal outcomes
   - idempotency keys
   - replay-safe polling
   - lost-confirmation sweep
   - Node/Python SDK helpers
   Keep this concise and user-facing.

   H. Safety and governance model
   Explain policy checks, HITL, audit ledger, and evidence without making vague compliance claims.

   I. Links
   Docs, SDK/API, demo, security, contributing, license.

3. Screenshot handling:
   - Audit every README image reference.
   - Remove or demote screenshots that no longer represent the current product.
   - If you can generate fresh screenshots safely from a local run without external side effects, propose the exact screenshot list and commands, but do not leave a long-running server alive.
   - If fresh screenshots require Wes to run the app manually, add a clear TODO checklist instead of pretending the stale ones are fine.

4. Verification:
   Run the smallest meaningful gates after editing:
   - markdown/link sanity if a repo script exists, likely `npm run docs:check`
   - `npm run lint` only if README changes touch generated docs/scripts or if the repo expects it
   - search README for stale phrases:
     - "Govern Claude Code in 5 minutes"
     - "50 verified Claude Code integrations"
     - old screenshot paths that no longer match reality
     - any unsupported claim
   - `git diff -- README.md` review

5. Final response must include:
   - what changed in the README
   - what old framing was removed
   - what screenshots/assets remain questionable
   - exact gates run and results
   - final `git status --short`
   - whether this is ready to commit

Recommended direction:
Use this as the new north star:

"DashClaw is the governance layer for AI agents that can touch real systems. It gives agents a policy firewall, human approval path, audit ledger, and durable outcome tracking across MCP, SDK, hooks, plugins, and direct APIs."

Tone:
Clear, technical, confident. Not hype. Not enterprise jargon. Not Claude Code tunnel vision.
```
