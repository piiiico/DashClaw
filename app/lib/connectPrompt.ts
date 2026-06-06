/**
 * Generates a markdown prompt users can paste into any AI agent session
 * to self-configure a connection to their DashClaw dashboard.
 */
export function generateConnectPrompt(baseUrl: string, orgName: string): string {
  return `# DashClaw Agent Setup

DashClaw is your AI agent decision infrastructure. It tracks decisions, enforces policies, tracks assumptions, and surfaces risk signals.

- **Dashboard**: ${baseUrl}/dashboard
- **Workspace**: ${orgName}

## 1. Set your environment variables

Before doing anything else, set these in your environment (shell, \`.env\`, etc.).
Do NOT paste the key into this chat.

\`\`\`bash
export DASHCLAW_API_KEY="<your-key>"
export DASHCLAW_AGENT_ID="my-agent"  # optional but recommended; uniquely identifies this agent process
\`\`\`

## 2. Install the SDK

\`\`\`bash
# Node.js
npm install dashclaw

# Python
pip install dashclaw
\`\`\`

## 3. Run the four-step governance loop

\`\`\`js
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: '${baseUrl}',
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: process.env.DASHCLAW_AGENT_ID || 'my-agent',
});

// 1. Check policy before acting
const decision = await claw.guard({
  action_type: 'test',
  declared_goal: 'Verify DashClaw connection',
  risk_score: 5,
});

// 2. Record the action
const { action_id } = await claw.createAction({
  action_type: 'test',
  declared_goal: 'Verify DashClaw connection',
  risk_score: 5,
});

// 3. Record what you assumed
await claw.recordAssumption({
  action_id,
  assumption: 'DashClaw instance is reachable',
});

// 4. Close the loop
await claw.updateOutcome(action_id, { status: 'completed' });

console.log('DashClaw action recorded:', action_id);
\`\`\`

## 4. Verify in the dashboard

Open \`${baseUrl}/decisions\` and confirm the action appears.

## 5. Optional: Install the CLI approval channel

\`\`\`bash
npm install -g @dashclaw/cli
\`\`\`

Approve pending actions from the terminal:

\`\`\`bash
dashclaw approvals          # interactive inbox
dashclaw approve <actionId> # approve a specific action
\`\`\`

When a policy gate fires, the agent prints the action ID and replay link to your terminal and blocks until you approve.

## What to report

Use the SDK to instrument any action your agent takes: file writes, API calls, deployments, decisions. Every governed action creates a replayable evidence record at \`${baseUrl}/replay/<actionId>\`.

## Reference

Full SDK docs: ${baseUrl}/docs
Decision replays: ${baseUrl}/replay/<actionId>
CLI approval inbox: ${baseUrl}/approvals
`;
}

/**
 * Generates an advanced prompt users can paste into an AI agent to run
 * a full SDK/API/dashboard/docs coverage pass.
 */
export function generateCoveragePrompt(baseUrl: string, orgName: string): string {
  return `# DashClaw SDK + Dashboard Coverage Pass

You are working in the DashClaw codebase and must perform a full SDK-to-platform coverage pass for workspace "${orgName}".

Rules:
- Do NOT ask for raw secrets in chat.
- Use environment variables for auth (for example: \`DASHCLAW_API_KEY\`).
- Keep changes additive and backward compatible where possible.
- Preserve org isolation and existing auth/role controls.

Base URLs:
- Dashboard: ${baseUrl}/dashboard
- Docs: ${baseUrl}/docs

Goal:
Ensure every meaningful SDK capability is:
1) correctly wired to DashClaw APIs and persistence,
2) visible on dashboards/product surfaces where appropriate,
3) documented for operators and SDK users,
4) covered by tests.

Execution checklist:
1. Inventory SDK capabilities
- Enumerate public methods in:
  - \`sdk/dashclaw.js\`
  - \`sdk-python/dashclaw/client.py\`
- Group by domain (actions, presence, loops, assumptions, approvals, guard, learning, drift, scoring, prompts, feedback, routing, messaging, webhooks, compliance, etc.).

2. Build a coverage matrix
- For each method, map:
  - API route(s)
  - DB table(s)
  - dashboard/page visibility
  - docs location
  - tests
  - status: complete | partial | missing

3. Verify ingestion and visibility
- Confirm request/response contracts and persistence fields.
- Confirm org scoping and auth behavior.
- Ensure high-value signals are surfaced in UI (cards/tables/charts/pages).

4. Fill gaps
- Implement missing ingestion/storage/UI coverage.
- Add non-breaking derived summary endpoints if needed for dashboard clarity/performance.
- Align JS/Python SDK behavior where mismatched.

5. Update docs (required)
- Update internal/operator docs with data lineage:
  SDK call -> API -> DB -> Dashboard.
- Update SDK docs with method coverage and visibility notes.
- Add a changelog entry.

6. Add/update tests (required)
- Include happy paths + key edge cases.
- Include org-scoping and visibility assertions.
- Add regressions for dashboard summary counts and states.

Deliverables:
- Code changes
- Updated coverage matrix committed to the repo
- Updated docs/changelog
- Passing tests
- Final summary with:
  - root causes found
  - what changed
  - how to verify via API + dashboard
  - any remaining gaps
`;
}
