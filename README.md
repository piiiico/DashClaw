<div align="center">
  <img src="public/images/logo-circular.png" alt="DashClaw" width="240" />
  <h1>DashClaw</h1>
  <p><strong>Decision Infrastructure for AI agents.</strong></p>
  <p>Stop agents before they make expensive mistakes.</p>
  <p><sub>Try it in 10 seconds</sub></p>
  <pre><code>npx dashclaw-demo</code></pre>
  <p><sub>No setup. Opens Decision Replay automatically.</sub></p>

  <img src="public/images/demo-gif2.gif" alt="DashClaw Demo" width="1000" />

<br />
<p><strong>Works with:</strong></p>
<p>LangChain • CrewAI • OpenClaw • OpenAI • Anthropic • AutoGen • Claude Code • Codex • Gemini CLI • Custom agents</p>
  <br />
  <p>Intercept decisions. Enforce policies. Record evidence.</p>
  <br />
  <p><strong>Agent &rarr; DashClaw &rarr; External Systems</strong></p>
  <p>DashClaw sits between your agents and your external systems. It evaluates policies before an agent action executes and records verifiable evidence of every decision.</p>
  <br />
  <p><a href="https://dashclaw.io/demo">View Live Demo</a></p>

  <a href="https://dashclaw.io"><img src="https://img.shields.io/badge/website-dashclaw.io-orange?style=flat-square" alt="Website" /></a>
  <a href="https://dashclaw.io/docs"><img src="https://img.shields.io/badge/docs-SDK%20%26%20API-blue?style=flat-square" alt="Docs" /></a>
  <a href="https://github.com/ucsandman/DashClaw/stargazers"><img src="https://img.shields.io/github/stars/ucsandman/DashClaw?style=flat-square&color=yellow" alt="GitHub stars" /></a>
  <a href="https://github.com/ucsandman/DashClaw/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" /></a>
  <a href="https://www.npmjs.com/package/dashclaw"><img src="https://img.shields.io/npm/v/dashclaw?style=flat-square&color=orange" alt="npm" /></a>
  <a href="https://pypi.org/project/dashclaw/"><img src="https://img.shields.io/pypi/v/dashclaw?style=flat-square&color=orange" alt="PyPI" /></a>

</div>

<br />

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fucsandman%2FDashClaw&env=DATABASE_URL,DASHCLAW_API_KEY,ENCRYPTION_KEY,NEXTAUTH_SECRET,NEXTAUTH_URL,CRON_SECRET,DASHCLAW_LOCAL_ADMIN_PASSWORD&envDescription=Required%20DashClaw%20configuration.%20See%20.env.example%20for%20details.&envLink=https%3A%2F%2Fgithub.com%2Fucsandman%2FDashClaw%2Fblob%2Fmain%2F.env.example&project-name=my-dashclaw&repository-name=my-dashclaw&products=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D&skippable-integrations=1)

**$0 to deploy** — Vercel free tier + Neon free tier. Click the button, add the Neon integration when prompted, fill in the environment variables, and you're live. Database schema is created automatically during the build — no manual migration step required.

### After deploy

1. **Open your app** — Visit `https://your-app.vercel.app` and sign in.
2. **Copy the snippet** — Mission Control shows a ready-to-run code example with your API key and base URL pre-filled.
3. **Run it** — `node --env-file=.env demo.js` and watch governance happen.

#### Optional

- **Live decision stream** — Create a free [Upstash Redis](https://upstash.com) instance and add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Vercel env vars. Without this, Mission Control uses in-memory events (fine for getting started, but won't persist across serverless invocations).
- **Verify at /setup** — Open `https://your-app.vercel.app/setup` to confirm all systems are green.

---

## Connect Your Agent

**Three ways to get governed — pick what fits your workflow:**

### Option 1: Install the skill (30 seconds)

Give your AI agent the `dashclaw-platform-intelligence` skill and it instruments itself — no code changes, no manual wiring. The agent registers with DashClaw, sets up guard checks, records decisions, and starts tracking assumptions automatically.

```bash
# Download the skill into your agent's skill directory
cp -r public/downloads/dashclaw-platform-intelligence .claude/skills/
```

Set two environment variables and your agent is governed on its next run:
```bash
export DASHCLAW_BASE_URL=https://your-dashclaw-instance.com
export DASHCLAW_API_KEY=your_api_key
```

This is the fastest path. We gave our own OpenClaw agent the skill and it put itself on DashClaw in one conversation.

### Option 2: Drop in Claude Code hooks (zero-code)

Govern 40+ tool types with semantic classification — every Bash, Edit, Write, MultiEdit, and more — no SDK instrumentation needed. The bundled `dashclaw_agent_intel` module handles tool classification, risk scoring, and signal extraction automatically:

```bash
cp hooks/dashclaw_pretool.py  .claude/hooks/
cp hooks/dashclaw_posttool.py .claude/hooks/
```

Set `DASHCLAW_BASE_URL`, `DASHCLAW_API_KEY`, and `DASHCLAW_HOOK_MODE=enforce`. Every tool call becomes a governed, replayable decision record. See [hooks/README.md](hooks/README.md) for the full guide.

### Option 3: Use the SDK (full control)

For custom agents where you want precise control over what gets governed:

```bash
npm install dashclaw    # Node.js
pip install dashclaw    # Python
```

The 4-step governance loop — Guard, Record, Verify, Outcome — is covered in the [Quickstart](#quickstart) below.

For framework-specific step-by-step guides (Claude Code, OpenAI Agents SDK, LangGraph, CrewAI), visit [`/connect`](https://dashclaw.io/connect) on your DashClaw instance.

---

## What is DashClaw?

DashClaw is not observability. It is **control before execution**.

AI agents generate actions from goals and context. They do not follow deterministic code paths. Therefore debugging alone is insufficient. **Agents require governance.**

DashClaw provides decision infrastructure to:
* Intercept risky agent actions.
* Enforce policy checks before execution.
* Require human approval (HITL) for sensitive operations.
* Record verifiable decision evidence to detect reasoning drift.
* Track agent learning velocity — the only platform that measures whether your agents are getting better or worse over time.
* Track session lifecycle with automatic recovery — sessions are created, monitored, and recoverable across agent restarts.
* Enforce 3 new policy types: **permission escalation** (requires elevated permission_level), **green contract** (requires test verification before deploy), and **branch freshness** (blocks actions on stale branches).
* Emit 4 new signal types for fine-grained governance decisions.
* Generate recovery recipes — actionable remediation steps returned in guard responses when actions are blocked or degraded.

---

## ⚡ See DashClaw stop an agent from deleting production data

Run DashClaw instantly with **one command**.

```bash
npx dashclaw-demo
```

What happens:
1. A local DashClaw demo runtime starts automatically.
2. A demo agent attempts a **high-risk production deploy**.
3. DashClaw intercepts the decision and **blocks the action before execution**.
4. Your browser opens directly to the **Decision Replay** showing the governance trail.

No repo clone. No environment variables. No configuration. Just one command.

---

### What you’ll see

- 🔴 High risk score (85)
- 🛑 Policy requires approval before deploy
- 🧠 Assumptions recorded by the agent
- 📊 Full decision timeline with outcome

![DashClaw Decision Replay](public/images/screenshots/Replay.png)

---

## Platform Overview

<div align="center">

**Mission Control** — Real-time strategic posture, decision timeline, and intervention feed.

<img src="public/images/screenshots/Mission Control.png" alt="Mission Control" width="1000" />

<br /><br />

**Approval Queue** — Human-in-the-loop intervention with risk scores and one-click Allow / Deny.

<img src="public/images/screenshots/Approvals.png" alt="Approval Queue" width="1000" />

<br /><br />

**Guard Policies** — Declarative rules that govern agent behavior before actions execute.

<img src="public/images/screenshots/policies.png" alt="Guard Policies" width="1000" />

<br /><br />

**Drift Detection** — Statistical behavioral drift analysis with critical alerts when agents deviate from baselines.

<img src="public/images/screenshots/Assumptions.png" alt="Drift Detection" width="1000" />

</div>

---

## 🏗️ First Real Agent

**Fastest**: Install the [dashclaw-platform-intelligence skill](#option-1-install-the-skill-30-seconds) and let your agent instrument itself.

**Hands-on**: Use the **OpenAI Governed Agent Starter** to see the SDK in a real customer communication workflow:

```bash
cd examples/openai-governed-agent
npm install && cp .env.example .env
# Add your DASHCLAW_API_KEY to .env
node index.js
```

[View the Starter Source](./examples/openai-governed-agent)

---

## Quickstart

### 1. Install the SDK

**Node.js:**
```bash
npm install dashclaw
```

**Python:**
```bash
pip install dashclaw
```

### 2. Create the Client

**Node.js:**
```javascript
import { DashClaw, GuardBlockedError, ApprovalDeniedError } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL, // or your DashClaw instance URL
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent'
});
```

**Python:**
```python
from dashclaw.client import DashClaw, GuardBlockedError, ApprovalDeniedError
import os

claw = DashClaw(
    base_url=os.environ["DASHCLAW_BASE_URL"],
    api_key=os.environ.get('DASHCLAW_API_KEY'),
    agent_id='my-agent'
)
```

### 3. Run Your First Governed Action

The minimal governance loop wraps your agent's real-world actions:

```javascript
// 1. Guard -> "Can I do X?"
const decision = await claw.guard({
  action_type: 'database_query',
  risk_score: 50
});

// 2. Record -> "I am attempting X."
const action = await claw.createAction({
  action_type: 'database_query',
  declared_goal: 'Extract user statistics'
});

// 3. Verify -> "I believe Y is true while doing X."
await claw.recordAssumption({
  action_id: action.action_id,
  assumption: 'The database is read-only for this credentials'
});

try {
  // Execute the real action here...
  // ...

  // 4. Outcome -> "X finished with result Z."
  await claw.updateOutcome(action.action_id, { status: 'completed' });
} catch (error) {
  await claw.updateOutcome(action.action_id, { status: 'failed', error_message: error.message });
}
```

> **Learning loop**: The guard response includes a `learning` field with your agent's historical performance — recent scores, drift status, and patterns learned from past outcomes. Your agent gets smarter every cycle.

---

## CLI Approval Channel

Approve agent actions from the terminal without opening a browser. This is the primary interface for developers using Claude Code, Codex, Gemini CLI, or any terminal-first workflow.

```bash
npm install -g @dashclaw/cli
```

```bash
dashclaw approvals              # interactive inbox for all pending actions
dashclaw approve <actionId>     # approve a specific action
dashclaw deny <actionId> --reason "Outside change window"
```

When an agent calls `waitForApproval()`, the SDK prints a structured block to stdout showing the action ID, policy name, risk score, declared goal, and a replay link. Approve from any terminal and the agent unblocks instantly via SSE. The browser dashboard reflects the same decision within one second.

Every governed action has a permanent replay URL:

```
<DASHCLAW_BASE_URL>/replay/<actionId>
```

### Discord & Slack Notifications

Approval requests also push to Discord and Slack so your team catches high-risk actions without watching a terminal.

<div align="center">
<img src="public/images/screenshots/discord.png" alt="DashClaw Discord approval notification" width="520" />
</div>

---

## Local SDK Testing

DashClaw includes a standalone Python integration test agent that exercises the major DashClaw SDK methods directly against a running instance.

To run it locally:
```bash
export DASHCLAW_API_KEY="your-api-key"
export DASHCLAW_BASE_URL="http://localhost:3000"

# Run the full SDK test agent
python scripts/test-sdk-agent.py --full
```
See the script comments for more flags and usage.

---

## Deploy to Cloud (Self-Host)

The fastest path to self-host DashClaw is via **Vercel + Neon**.

1. Fork this repo.
2. Deploy to Vercel and connect a free [Neon](https://neon.tech) Postgres database.
3. Run the interactive setup to configure secrets and run migrations:
   ```bash
   node scripts/setup.mjs
   ```
4. Your instance is live. Grab your API key from the dashboard and point your first agent at it.

---

## Full SDK Documentation

For the complete API surface, check out the [SDK Reference](./docs/sdk-reference.md).

---

## License

[MIT](LICENSE)

<div align="center">
  <br />
  <img src="public/images/github-social-preview-ps.png" alt="Practical Systems" width="600" />
  <br />
  <sub>Built by <a href="https://practicalsystems.io">Practical Systems</a></sub>
</div>