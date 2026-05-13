/**
 * @dashclaw/openclaw-plugin
 *
 * OpenClaw plugin that routes every tool call through DashClaw governance:
 *   1. `before_tool_call` → `guard()` + optional `waitForApproval()` +
 *      `createAction()` to open a governance record.
 *   2. `after_tool_call`  → `updateOutcome()` to close that record.
 *
 * Type accuracy notes (verified against `openclaw` plugin SDK types):
 *   - `PluginHookBeforeToolCallResult` uses `blockReason`, not `reason`.
 *   - `PluginKind` is `"memory" | "context-engine"` — neither applies to this
 *     generic hook plugin, so the manifest and `definePluginEntry` call both
 *     omit `kind`.
 *   - Event/context field shapes come from `PluginHookBeforeToolCallEvent`,
 *     `PluginHookAfterToolCallEvent`, and `PluginHookToolContext`. No
 *     defensive fallbacks for alternative field names are needed.
 *
 * The DashClaw client is cached at module scope and rebuilt only when the
 * resolved config key changes, mirroring the pattern used by OpenClaw's
 * bundled MemOS plugin.
 */
import { definePluginEntry, } from 'openclaw/plugin-sdk/plugin-entry';
import { DashClaw, } from 'dashclaw';
/**
 * Resolve the DashClaw URL from (in order of precedence):
 *   1. `config.dashclawUrl`                    (canonical plugin-config key)
 *   2. `config.baseUrl`                        (SDK-style alias)
 *   3. `process.env.DASHCLAW_BASE_URL`         (canonical env var — matches CLI, local scripts)
 *   4. `process.env.DASHCLAW_URL`              (legacy env var — matches MCP server docs)
 *
 * The same precedence applies to the API key (with DASHCLAW_API_KEY as the only env var).
 */
function firstString(...candidates) {
    for (const c of candidates) {
        if (typeof c === 'string' && c.length > 0)
            return c;
    }
    return '';
}
function resolveConfig(raw) {
    const cfg = raw ?? {};
    const env = typeof process !== 'undefined' && process?.env ? process.env : {};
    const failClosed = cfg.failClosed !== false; // default true
    const riskScoreDefault = typeof cfg.riskScoreDefault === 'number' ? cfg.riskScoreDefault : 50;
    const highRiskTools = new Set(Array.isArray(cfg.highRiskTools)
        ? cfg.highRiskTools.filter((v) => typeof v === 'string')
        : []);
    const dashclawUrl = firstString(cfg.dashclawUrl, cfg.baseUrl, env.DASHCLAW_BASE_URL, env.DASHCLAW_URL);
    const dashclawApiKey = firstString(cfg.dashclawApiKey, cfg.apiKey, env.DASHCLAW_API_KEY);
    const agentId = firstString(cfg.agentId, env.DASHCLAW_AGENT_ID) || 'openclaw';
    const defaultModel = firstString(cfg.defaultModel, env.DASHCLAW_DEFAULT_MODEL);
    return {
        dashclawUrl,
        dashclawApiKey,
        agentId,
        defaultModel,
        failClosed,
        riskScoreDefault,
        highRiskTools,
    };
}
// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let cachedClient = null;
let cachedClientKey = '';
/** Maps synthetic call key → DashClaw action_id so `after_tool_call` can close it. */
const pendingActions = new Map();
const tokenTurnByRun = new Map();
// Cap for in-memory per-run state. `agent_end` deletes entries, but a crash
// or an agent framework that never fires `agent_end` in a long-lived gateway
// process would leak. At ~100 bytes/entry this cap bounds worst-case memory
// to ~100KB while still comfortably above typical concurrency.
const MAX_TURN_RUNS = 1000;
function getTokenTurn(runId) {
    let state = tokenTurnByRun.get(runId);
    if (!state) {
        if (tokenTurnByRun.size >= MAX_TURN_RUNS) {
            // Evict oldest (Map preserves insertion order). One at a time is enough
            // to stay at the cap under steady state — we only grow by one here.
            const oldest = tokenTurnByRun.keys().next().value;
            if (oldest !== undefined)
                tokenTurnByRun.delete(oldest);
        }
        state = { turnActionIds: [] };
        tokenTurnByRun.set(runId, state);
    }
    return state;
}
/** Split a non-negative integer `total` into `n` buckets, putting remainders
 *  in the earliest buckets so the sum is preserved exactly. */
function distributeEvenly(total, n) {
    if (n <= 0 || total <= 0)
        return new Array(Math.max(n, 0)).fill(0);
    const base = Math.floor(total / n);
    const remainder = total - base * n;
    return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}
async function distributePendingTokens(client, state) {
    const usage = state.pendingUsage;
    const ids = state.turnActionIds;
    state.pendingUsage = undefined;
    state.turnActionIds = [];
    if (!usage || ids.length === 0)
        return;
    if (usage.tokens_in === 0 && usage.tokens_out === 0)
        return;
    const inParts = distributeEvenly(usage.tokens_in, ids.length);
    const outParts = distributeEvenly(usage.tokens_out, ids.length);
    await Promise.all(ids.map((actionId, idx) => client
        .updateOutcome(actionId, {
        tokens_in: inParts[idx],
        tokens_out: outParts[idx],
        ...(usage.model ? { model: usage.model } : {}),
    })
        .catch((err) => {
        console.warn(`[dashclaw-governance] token PATCH failed for ${actionId}: ${errorMessage(err) || 'unknown'}`);
    })));
}
function getClient(config) {
    const key = `${config.dashclawUrl}|${config.dashclawApiKey}|${config.agentId}`;
    if (cachedClient && cachedClientKey === key)
        return cachedClient;
    if (!config.dashclawUrl || !config.dashclawApiKey) {
        const missing = [];
        if (!config.dashclawUrl)
            missing.push('dashclawUrl');
        if (!config.dashclawApiKey)
            missing.push('dashclawApiKey');
        throw new Error(`dashclaw-governance plugin: missing ${missing.join(' and ')}. ` +
            'Provide via openclaw.plugin.json config (dashclawUrl/dashclawApiKey or baseUrl/apiKey), ' +
            'or set env vars DASHCLAW_BASE_URL and DASHCLAW_API_KEY before starting the gateway.');
    }
    cachedClient = new DashClaw({
        baseUrl: config.dashclawUrl,
        apiKey: config.dashclawApiKey,
        agentId: config.agentId,
    });
    cachedClientKey = key;
    return cachedClient;
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function summarizeParams(params) {
    if (!params)
        return '';
    let serialized;
    try {
        serialized = JSON.stringify(params);
    }
    catch {
        return '[unserializable params]';
    }
    if (serialized.length <= 500)
        return serialized;
    return serialized.slice(0, 500) + '…[truncated]';
}
function callKey(toolName, toolCallId, runId) {
    // Prefer the provider-supplied tool call ID; fall back to runId-scoped tool
    // name so a later `after_tool_call` without a toolCallId can still find the
    // pending record.
    if (toolCallId)
        return `id:${toolCallId}`;
    if (runId)
        return `run:${runId}:${toolName}`;
    return `tool:${toolName}`;
}
function errorMessage(err) {
    if (!err)
        return '';
    if (typeof err === 'string')
        return err;
    if (err instanceof Error)
        return err.message;
    if (typeof err === 'object' && err !== null && 'message' in err) {
        const m = err.message;
        return typeof m === 'string' ? m : '';
    }
    return '';
}
const READONLY_COMMANDS = new Set([
    'cat', 'head', 'tail', 'less', 'more', 'wc', 'file', 'stat', 'du', 'df',
    'ls', 'tree', 'find', 'locate', 'which', 'whereis', 'type',
    'grep', 'rg', 'awk', 'cut', 'sort', 'uniq', 'diff', 'comm',
    'echo', 'printf', 'date', 'uname', 'whoami', 'pwd', 'hostname',
    'ps', 'top', 'htop', 'free', 'uptime', 'env', 'printenv',
]);
const GIT_READONLY = new Set([
    'status', 'log', 'diff', 'show', 'branch', 'tag', 'remote',
    'stash', 'describe', 'rev-parse', 'blame', 'ls-files',
]);
const DESTRUCTIVE_COMMANDS = new Set([
    'rm', 'rmdir', 'shred', 'mkfs', 'dd', 'truncate',
]);
const NETWORK_COMMANDS = new Set([
    'curl', 'wget', 'ssh', 'scp', 'rsync', 'ping',
]);
const PACKAGE_COMMANDS = new Set([
    'npm', 'yarn', 'pnpm', 'pip', 'pip3', 'cargo', 'go', 'gem',
    'brew', 'apt', 'apt-get', 'dnf',
]);
const DEPLOY_PATTERN = /(?:git\s+push|deploy|vercel|kubectl|terraform|docker\s+push|helm)/i;
const DESTRUCTIVE_PATTERN = /(?:rm\s+-rf|DROP\s+TABLE|DELETE\s+FROM|TRUNCATE)/i;
const SENSITIVE_PATH_PATTERN = /(?:\.env|secret|credential|private_key|\.pem|id_rsa|\.key)/i;
function classifyBash(command, defaultRisk) {
    if (!command) {
        return { actionType: 'other', riskScore: defaultRisk, reversible: true, systemsTouched: [], declaredGoal: 'Bash: (empty)' };
    }
    const goal = `Bash: ${command.slice(0, 120)}`;
    if (DESTRUCTIVE_PATTERN.test(command)) {
        return { actionType: 'security', riskScore: 90, reversible: false, systemsTouched: ['filesystem'], declaredGoal: goal };
    }
    if (DEPLOY_PATTERN.test(command)) {
        return { actionType: 'deploy', riskScore: 80, reversible: false, systemsTouched: ['production'], declaredGoal: goal };
    }
    const firstToken = command.trim().split(/[\s|;&]/)[0].replace(/^.*[/\\]/, '');
    if (firstToken === 'git') {
        const sub = command.match(/git\s+(\S+)/)?.[1] ?? '';
        if (GIT_READONLY.has(sub)) {
            return { actionType: 'review', riskScore: 10, reversible: true, systemsTouched: [], declaredGoal: goal };
        }
        if (sub === 'push') {
            return { actionType: 'deploy', riskScore: 75, reversible: false, systemsTouched: [], declaredGoal: goal };
        }
        return { actionType: 'apply', riskScore: 30, reversible: true, systemsTouched: [], declaredGoal: goal };
    }
    if (READONLY_COMMANDS.has(firstToken)) {
        return { actionType: 'review', riskScore: 10, reversible: true, systemsTouched: [], declaredGoal: goal };
    }
    if (DESTRUCTIVE_COMMANDS.has(firstToken)) {
        return { actionType: 'security', riskScore: 85, reversible: false, systemsTouched: ['filesystem'], declaredGoal: goal };
    }
    if (NETWORK_COMMANDS.has(firstToken)) {
        return { actionType: 'api', riskScore: 40, reversible: true, systemsTouched: [], declaredGoal: goal };
    }
    if (PACKAGE_COMMANDS.has(firstToken)) {
        return { actionType: 'build', riskScore: 30, reversible: true, systemsTouched: [], declaredGoal: goal };
    }
    return { actionType: 'other', riskScore: defaultRisk, reversible: true, systemsTouched: ['shell'], declaredGoal: goal };
}
function classifyFile(toolName, params, defaultRisk) {
    const filePath = String(params?.file_path ?? params?.path ?? '');
    const goal = `${toolName}: ${filePath || '(unknown)'}`;
    if (SENSITIVE_PATH_PATTERN.test(filePath)) {
        return { actionType: 'security', riskScore: 85, reversible: true, systemsTouched: ['filesystem'], declaredGoal: goal };
    }
    return { actionType: 'apply', riskScore: defaultRisk, reversible: true, systemsTouched: ['filesystem'], declaredGoal: goal };
}
function classifyToolCall(toolName, params, config) {
    const defaultRisk = config.highRiskTools.has(toolName) ? 85 : config.riskScoreDefault;
    if (toolName === 'bash' || toolName === 'exec') {
        return classifyBash(params?.command, defaultRisk);
    }
    if (toolName === 'write' || toolName === 'edit' || toolName === 'apply_patch') {
        return classifyFile(toolName, params, defaultRisk);
    }
    if (['read', 'web_search', 'web_fetch', 'memory_search', 'memory_get', 'image'].includes(toolName)) {
        const target = String(params?.file_path ?? params?.path ?? params?.query ?? '');
        return {
            actionType: 'review',
            riskScore: Math.min(defaultRisk, 15),
            reversible: true,
            systemsTouched: [],
            declaredGoal: `${toolName}: ${target.slice(0, 120) || '(unknown)'}`,
        };
    }
    if (toolName === 'sessions_send') {
        return {
            actionType: 'message',
            riskScore: defaultRisk,
            reversible: false,
            systemsTouched: [],
            declaredGoal: `message: ${summarizeParams(params).slice(0, 120)}`,
        };
    }
    return {
        actionType: 'other',
        riskScore: defaultRisk,
        reversible: true,
        systemsTouched: [],
        declaredGoal: `${toolName}: ${summarizeParams(params).slice(0, 120)}`,
    };
}
function isApproved(action) {
    if (!action)
        return false;
    if (action.approved_by)
        return true;
    return action.status === 'running' || action.status === 'completed';
}
// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------
export default definePluginEntry({
    id: 'dashclaw-governance',
    name: 'DashClaw Governance',
    description: 'Policy enforcement, human-in-the-loop approval, and decision recording for every OpenClaw tool call. Powered by DashClaw.',
    register(api) {
        const config = resolveConfig(api.pluginConfig);
        // -----------------------------------------------------------------------
        // Governance gate
        // -----------------------------------------------------------------------
        api.on('before_tool_call', async (event, _ctx) => {
            const { toolName, params, toolCallId, runId } = event;
            const key = callKey(toolName, toolCallId, runId);
            // Classify the tool call using the same vocabulary as DashClaw hooks
            // so policies written for Claude Code also fire for OpenClaw calls.
            const classification = classifyToolCall(toolName, params, config);
            const { actionType, riskScore, reversible, systemsTouched, declaredGoal } = classification;
            let client;
            try {
                client = getClient(config);
            }
            catch (err) {
                const msg = errorMessage(err) || 'unknown error';
                if (config.failClosed) {
                    return { block: true, blockReason: `DashClaw config error: ${msg}` };
                }
                console.warn(`[dashclaw-governance] config error (fail-open): ${msg}`);
                return;
            }
            let decision;
            try {
                decision = await client.guard({
                    action_type: actionType,
                    risk_score: riskScore,
                    declared_goal: declaredGoal,
                    reversible,
                    systems_touched: systemsTouched,
                });
            }
            catch (err) {
                const msg = errorMessage(err) || 'unknown error';
                if (config.failClosed) {
                    return {
                        block: true,
                        blockReason: `DashClaw unreachable — fail-closed policy (${msg})`,
                    };
                }
                console.warn(`[dashclaw-governance] guard call failed (fail-open): ${msg}`);
                return;
            }
            // Hard stop on block — never open an action record for a forbidden call.
            if (decision.decision === 'block') {
                return {
                    block: true,
                    blockReason: decision.reason || 'Blocked by DashClaw policy',
                };
            }
            if (decision.decision === 'warn') {
                console.warn(`[dashclaw-governance] WARN ${toolName}: ${decision.reason || 'flagged by policy'}`);
            }
            // Open a governance record. The server re-evaluates policy at this
            // point and is the authoritative source for HITL gating — even when
            // guard returned `allow`, the server may still set `pending_approval`
            // (for example, if the capability has `requires_approval=true`).
            //
            // NOTE: we MUST call `createAction` before `waitForApproval`, because
            // `waitForApproval` polls `GET /api/actions/:id` — which is backed by
            // the `action_records` table. `decision.action_id` from `guard()` is a
            // row in the separate `guard_decisions` table (prefix `act_gd_`) and
            // cannot be resolved by that endpoint.
            let createdActionId;
            let createdStatus;
            try {
                const created = await client.createAction({
                    action_type: actionType,
                    declared_goal: declaredGoal,
                    risk_score: riskScore,
                    reversible,
                    systems_touched: systemsTouched,
                    metadata: { openclaw_tool_name: toolName },
                });
                createdActionId =
                    created.action_id ?? created.action?.action_id ?? created.action?.id;
                createdStatus = created.action?.status;
            }
            catch (err) {
                const msg = errorMessage(err) || 'unknown';
                console.warn(`[dashclaw-governance] createAction failed: ${msg}`);
                if (config.failClosed) {
                    return {
                        block: true,
                        blockReason: `DashClaw action record could not be opened — fail-closed policy (${msg})`,
                    };
                }
                // Fail-open: proceed without an action record. We cannot wait for
                // approval (no ID to wait on) and outcome recording will be skipped.
                return;
            }
            // If the server flagged this for human review, wait on the action
            // record we just created. Either guard said `require_approval` OR the
            // server upgraded the action to `pending_approval` independently — we
            // trust the server's `action.status` over the guard advice.
            const needsApproval = decision.decision === 'require_approval' ||
                createdStatus === 'pending_approval';
            if (needsApproval && createdActionId) {
                try {
                    const { action } = await client.waitForApproval(createdActionId);
                    if (!isApproved(action)) {
                        return {
                            block: true,
                            blockReason: action?.error_message || 'Action denied by operator',
                        };
                    }
                }
                catch (err) {
                    return {
                        block: true,
                        blockReason: `Approval denied or wait failed: ${errorMessage(err) || 'denied'}`,
                    };
                }
            }
            if (createdActionId) {
                pendingActions.set(key, createdActionId);
                // Track this action_id against the current run so the next
                // `llm_output` can attribute token usage back to it.
                if (runId)
                    getTokenTurn(runId).turnActionIds.push(createdActionId);
            }
            return;
        });
        // -----------------------------------------------------------------------
        // LLM token attribution — distribute the previous turn's usage across
        // the tool calls it induced, then stash this turn's usage for the next
        // boundary. Runs best-effort; failures never surface to the agent.
        // -----------------------------------------------------------------------
        api.on('llm_output', async (event, _ctx) => {
            const { runId, model, usage } = event;
            if (!runId)
                return;
            let client;
            try {
                client = getClient(config);
            }
            catch (err) {
                // No client → skip attribution, don't disrupt the run. Log once per
                // failure class so ops notice when token tracking is off (key
                // rotation, base-URL typo) instead of silently losing every turn.
                console.warn(`[dashclaw-governance] llm_output dropped — client unavailable: ${errorMessage(err) || 'unknown'}`);
                return;
            }
            const state = getTokenTurn(runId);
            // Distribute the PREVIOUS turn's usage before stashing the new one.
            if (state.pendingUsage) {
                await distributePendingTokens(client, state);
            }
            // Stash this turn's usage for attribution on the next llm_output
            // (or agent_end). Cache reads are billed at ~10% of base input price, so
            // we weight them at 0.1 before summing — the server's pricing table
            // doesn't model the cache discount, so applying it here keeps the
            // derived cost aligned with real billing. Cache writes stay at full
            // price (close enough for 5m caching; slightly under-counts 1h).
            if (usage) {
                const cacheReadEffective = Math.round((usage.cacheRead ?? 0) * 0.1);
                const tokens_in = (usage.input ?? 0) + (usage.cacheWrite ?? 0) + cacheReadEffective;
                const tokens_out = usage.output ?? 0;
                if (tokens_in > 0 || tokens_out > 0) {
                    // Model resolution: real event value > configured default > empty.
                    // When both are empty, still stash the tokens so ops see activity,
                    // but log a one-time breadcrumb per run — otherwise the "tokens
                    // arrive but cost stays $0" failure mode is invisible.
                    const resolvedModel = (model && model.length > 0)
                        ? model
                        : config.defaultModel;
                    if (!resolvedModel && !state.warnedMissingModel) {
                        console.warn(`[dashclaw-governance] llm_output has no model for run ${runId} — ` +
                            `tokens will land on action records but cost_estimate will stay $0. ` +
                            `Set config.defaultModel or DASHCLAW_DEFAULT_MODEL to price these turns.`);
                        state.warnedMissingModel = true;
                    }
                    state.pendingUsage = { tokens_in, tokens_out, model: resolvedModel };
                }
            }
        });
        // -----------------------------------------------------------------------
        // Run end — flush any remaining usage, then drop per-run state.
        // -----------------------------------------------------------------------
        api.on('agent_end', async (_event, ctx) => {
            const runId = ctx?.runId;
            if (!runId)
                return;
            const state = tokenTurnByRun.get(runId);
            if (!state)
                return;
            if (state.pendingUsage && state.turnActionIds.length > 0) {
                try {
                    const client = getClient(config);
                    await distributePendingTokens(client, state);
                }
                catch (err) {
                    // No client → drop state but log the lost attribution so ops can
                    // see how many actions went unattributed.
                    console.warn(`[dashclaw-governance] agent_end token flush dropped ${state.turnActionIds.length} action(s): ${errorMessage(err) || 'unknown'}`);
                }
            }
            tokenTurnByRun.delete(runId);
        });
        // -----------------------------------------------------------------------
        // Outcome recorder
        // -----------------------------------------------------------------------
        api.on('after_tool_call', async (event, _ctx) => {
            const { toolName, toolCallId, runId, error } = event;
            const key = callKey(toolName, toolCallId, runId);
            const actionId = pendingActions.get(key);
            if (!actionId)
                return;
            pendingActions.delete(key);
            const status = error ? 'failed' : 'completed';
            let client;
            try {
                client = getClient(config);
            }
            catch {
                return; // No client → cannot record; never break tool execution.
            }
            try {
                await client.updateOutcome(actionId, {
                    status,
                    ...(error ? { error_message: error } : {}),
                });
            }
            catch (err) {
                console.warn(`[dashclaw-governance] updateOutcome failed: ${errorMessage(err) || 'unknown'}`);
            }
        });
    },
});
