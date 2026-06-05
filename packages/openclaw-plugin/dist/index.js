/**
 * @dashclaw/openclaw-plugin
 *
 * OpenClaw plugin that routes every tool call through DashClaw governance:
 *   1. `before_tool_call` → `guard()` + optional `waitForApproval()` +
 *      `createAction()` to open a governance record.
 *   2. `after_tool_call`  → `updateOutcome()` to close that record.
 *
 * x402 capability payments (e.g. an `agentcash fetch`) take a dedicated path:
 * `before_tool_call` gates them with `action_type:'x402_purchase'` (so an
 * `x402_spend_limit` policy can block an over-budget payment before it runs),
 * and `after_tool_call` records the settled spend via `recordPurchase()` +
 * `recordPurchaseResult()`. The agent still executes the payment itself
 * (govern-not-do); DashClaw only guards and records it.
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
    const x402Enabled = cfg.x402Enabled !== false; // default true
    const rawPatterns = Array.isArray(cfg.x402CommandPatterns) && cfg.x402CommandPatterns.length
        ? cfg.x402CommandPatterns.filter((v) => typeof v === 'string')
        : ['agentcash[\\s@][\\s\\S]*\\bfetch\\b'];
    const x402CommandPatterns = rawPatterns
        .map((p) => {
        try {
            return new RegExp(p, 'i');
        }
        catch {
            console.warn(`[dashclaw-governance] invalid x402CommandPattern ignored: ${p}`);
            return null;
        }
    })
        .filter((r) => r !== null);
    const x402ToolNames = new Set(Array.isArray(cfg.x402ToolNames)
        ? cfg.x402ToolNames.filter((v) => typeof v === 'string')
        : []);
    const x402EstimatedCostUsd = typeof cfg.x402EstimatedCostUsd === 'number' && cfg.x402EstimatedCostUsd >= 0
        ? cfg.x402EstimatedCostUsd
        : 0.01;
    const x402AutoRegisterProviders = cfg.x402AutoRegisterProviders !== false; // default true
    return {
        dashclawUrl,
        dashclawApiKey,
        agentId,
        defaultModel,
        failClosed,
        riskScoreDefault,
        highRiskTools,
        x402Enabled,
        x402CommandPatterns,
        x402ToolNames,
        x402EstimatedCostUsd,
        x402AutoRegisterProviders,
    };
}
// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let cachedClient = null;
let cachedClientKey = '';
/** Maps synthetic call key → DashClaw action_id so `after_tool_call` can close it. */
const pendingActions = new Map();
const x402PendingByKey = new Map();
/** Cache of x402 provider origin → DashClaw provider_id (best-effort auto-registration). */
const providerIdByOrigin = new Map();
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
function detectX402(toolName, params, config) {
    if (!config.x402Enabled)
        return null;
    const command = toolName === 'bash' || toolName === 'exec'
        ? String(params?.command ?? '')
        : '';
    const matchedByName = config.x402ToolNames.has(toolName);
    const matchedByCommand = command.length > 0 && config.x402CommandPatterns.some((re) => re.test(command));
    if (!matchedByName && !matchedByCommand)
        return null;
    // Resolve the target URL → origin host (the "provider").
    const urlFromParams = String(params?.url ?? params?.endpoint ?? params?.uri ?? '');
    const urlFromCommand = command.match(/https?:\/\/[^\s'"`]+/)?.[0] ?? '';
    const url = urlFromParams || urlFromCommand;
    let origin = '';
    try {
        origin = url ? new URL(url).host : '';
    }
    catch {
        origin = '';
    }
    // Pre-payment estimate: the agent's --max-amount ceiling, else an explicit
    // amount param, else the configured fallback. Conservative on purpose so the
    // guard evaluates the worst-case spend before the payment runs.
    let estimate = config.x402EstimatedCostUsd;
    const maxAmt = command.match(/--max-amount[=\s]+([0-9]*\.?[0-9]+)/);
    if (maxAmt) {
        estimate = Number(maxAmt[1]);
    }
    else if (typeof params?.maxAmount === 'number') {
        estimate = params.maxAmount;
    }
    else if (typeof params?.amount === 'number') {
        estimate = params.amount;
    }
    if (!Number.isFinite(estimate) || estimate < 0)
        estimate = config.x402EstimatedCostUsd;
    return { origin: origin || 'unknown-x402-provider', url, estimate };
}
/**
 * Parse an agentcash success envelope from a tool result. Returns null when the
 * result is not a settled paid call (a free `check`, a 402-not-paid, or no
 * parseable payload), so we only record purchases that actually moved money.
 */
function parseX402Receipt(result) {
    let obj = result;
    if (typeof result === 'string') {
        try {
            obj = JSON.parse(result);
        }
        catch {
            const block = result.match(/\{[\s\S]*\}/);
            if (!block)
                return null;
            try {
                obj = JSON.parse(block[0]);
            }
            catch {
                return null;
            }
        }
    }
    if (!obj || typeof obj !== 'object')
        return null;
    const env = obj;
    const data = (env.data ?? env);
    const metadata = (env.metadata ?? {});
    let spend = Number(data?.costDollars?.total);
    if (!Number.isFinite(spend)) {
        const pm = String(metadata?.price ?? '').match(/([0-9]*\.?[0-9]+)/);
        spend = pm ? Number(pm[1]) : NaN;
    }
    if (!Number.isFinite(spend) || spend <= 0)
        return null; // not a settled payment
    return {
        spend,
        txHash: typeof metadata?.payment?.transactionHash === 'string'
            ? metadata.payment.transactionHash
            : undefined,
        requestId: typeof data?.requestId === 'string' ? data.requestId : undefined,
    };
}
/**
 * Best-effort: resolve (or create) a DashClaw provider_id for an origin so the
 * Spend → x402 surface can group purchases by provider. Cached per origin;
 * never throws — on any failure the purchase is recorded with a free-text
 * provider and a null provider_id.
 */
async function resolveProviderId(client, config, origin) {
    if (!config.x402AutoRegisterProviders ||
        !origin ||
        origin === 'unknown-x402-provider') {
        return undefined;
    }
    const cached = providerIdByOrigin.get(origin);
    if (cached)
        return cached;
    try {
        const listed = await client.listProviders();
        const providers = Array.isArray(listed)
            ? listed
            : (listed?.providers ?? []);
        const match = providers.find((p) => p?.name === origin ||
            (typeof p?.base_url === 'string' && p.base_url.includes(origin)));
        let id = match?.provider_id ?? match?.id;
        if (!id) {
            const created = (await client.createProvider({
                name: origin,
                base_url: `https://${origin}`,
                category: 'research',
                default_currency: 'USDC',
                metadata: { source: 'openclaw-x402' },
            }));
            id = created?.provider?.provider_id ?? created?.provider_id ?? created?.id;
        }
        if (id) {
            providerIdByOrigin.set(origin, id);
            return id;
        }
    }
    catch (err) {
        console.warn(`[dashclaw-governance] x402 provider resolve failed for ${origin}: ${errorMessage(err) || 'unknown'}`);
    }
    return undefined;
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
            // Lazily open an Agent Session on the FIRST tool call of this run so the
            // run appears under DashClaw's Agent Sessions (not just Code Sessions).
            // Fail-safe: a session error NEVER blocks the tool call or the run.
            if (runId) {
                const runState = getTokenTurn(runId);
                if (!runState.sessionStarted) {
                    runState.sessionStarted = true; // guard before await — once per run
                    const ev = event;
                    const workspace = typeof ev.workspace === 'string' ? ev.workspace : undefined;
                    const branch = typeof ev.branch === 'string' ? ev.branch : null;
                    try {
                        const res = await client.createSession(config.agentId, workspace, branch);
                        const sessionId = res.session?.id ??
                            res.id;
                        if (sessionId)
                            runState.sessionId = sessionId;
                    }
                    catch (err) {
                        console.warn(`[dashclaw-governance] createSession failed: ${errorMessage(err) || 'unknown'}`);
                    }
                }
            }
            // x402 spend governance: if this tool call is a capability PAYMENT
            // (e.g. an agentcash `fetch`), gate it on its own x402 path so
            // x402_spend_limit policies can block an over-budget purchase BEFORE the
            // payment runs. On allow, mark it pending so after_tool_call records the
            // settled spend. This REPLACES the generic governance path for this call
            // (no duplicate action record).
            const x402 = detectX402(toolName, params, config);
            if (x402) {
                const x402Goal = `x402 purchase: ${x402.origin}`;
                let x402Decision;
                try {
                    x402Decision = await client.guard({
                        action_type: 'x402_purchase',
                        provider: x402.origin,
                        cost_estimate: x402.estimate,
                        risk_score: 40,
                        declared_goal: x402Goal,
                        reversible: false,
                        systems_touched: ['x402', x402.origin],
                    });
                }
                catch (err) {
                    const msg = errorMessage(err) || 'unknown error';
                    if (config.failClosed) {
                        return {
                            block: true,
                            blockReason: `DashClaw unreachable — x402 payment to ${x402.origin} blocked (fail-closed): ${msg}`,
                        };
                    }
                    // Fail-open: don't gate, but still record the settled spend after.
                    console.warn(`[dashclaw-governance] x402 guard failed (fail-open): ${msg}`);
                    x402PendingByKey.set(key, { origin: x402.origin, declaredGoal: x402Goal, estimate: x402.estimate });
                    return;
                }
                if (x402Decision.decision === 'block' || x402Decision.decision === 'require_approval') {
                    const why = x402Decision.decision === 'require_approval'
                        ? 'requires approval — adjust the x402_spend_limit policy threshold to allow it'
                        : x402Decision.reason || 'blocked by x402 spend policy';
                    return {
                        block: true,
                        blockReason: `x402 payment to ${x402.origin} (~$${x402.estimate}) ${why}`,
                    };
                }
                if (x402Decision.decision === 'warn') {
                    console.warn(`[dashclaw-governance] WARN x402 ${x402.origin}: ${x402Decision.reason || 'flagged by policy'}`);
                }
                // Allowed → record after the payment settles.
                x402PendingByKey.set(key, { origin: x402.origin, declaredGoal: x402Goal, estimate: x402.estimate });
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
            let client = null;
            try {
                client = getClient(config);
            }
            catch (err) {
                // No client → can't flush tokens or close the session. Log both losses
                // so ops can see what went unrecorded.
                const lost = state.turnActionIds.length;
                if ((state.pendingUsage && lost > 0) || state.sessionId) {
                    console.warn(`[dashclaw-governance] agent_end cleanup dropped (client unavailable): ${lost} token action(s), session ${state.sessionId ?? 'none'}: ${errorMessage(err) || 'unknown'}`);
                }
            }
            if (client && state.pendingUsage && state.turnActionIds.length > 0) {
                await distributePendingTokens(client, state);
            }
            // Close the Agent Session opened for this run. 'completed' is the
            // terminal status the Sessions UI treats as finished. Fail-safe.
            if (client && state.sessionId) {
                try {
                    await client.updateSession(state.sessionId, { status: 'completed' });
                }
                catch (err) {
                    console.warn(`[dashclaw-governance] updateSession(end) failed for ${state.sessionId}: ${errorMessage(err) || 'unknown'}`);
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
            // x402 spend governance: if this call was a gated x402 payment, record the
            // settled spend (the agent has already paid). This is the sole record for
            // the call — it does NOT go through the generic outcome path below.
            const x402pending = x402PendingByKey.get(key);
            if (x402pending) {
                x402PendingByKey.delete(key);
                let x402Client;
                try {
                    x402Client = getClient(config);
                }
                catch {
                    return;
                }
                if (error) {
                    // The payment tool errored → nothing settled to record.
                    console.warn(`[dashclaw-governance] x402 call to ${x402pending.origin} failed: ${error}`);
                    return;
                }
                const receipt = parseX402Receipt(event.result);
                if (!receipt) {
                    // No settled-payment receipt (free check, 402-not-paid, or the gateway
                    // didn't deliver the tool result to the plugin) — nothing to record.
                    return;
                }
                try {
                    const providerId = await resolveProviderId(x402Client, config, x402pending.origin);
                    const res = await x402Client.recordPurchase({
                        agent_id: config.agentId,
                        provider: x402pending.origin,
                        declared_goal: x402pending.declaredGoal,
                        purchase_reason: `Paid x402 capability call to ${x402pending.origin}`,
                        context_gap: `Capability gated behind payment at ${x402pending.origin}`,
                        expected_value: `Paid result from ${x402pending.origin}`,
                        spend_amount: receipt.spend,
                        cost_estimate: receipt.spend,
                        currency: 'USDC',
                        payment_method: 'x402',
                        ...(providerId ? { provider_id: providerId } : {}),
                    });
                    const purchaseActionId = res?.action?.action_id ??
                        res?.action_id ??
                        res?.action?.id;
                    if (purchaseActionId && (receipt.txHash || receipt.requestId)) {
                        await x402Client
                            .recordPurchaseResult(String(purchaseActionId), {
                            summary: `x402 settled: $${receipt.spend} USDC at ${x402pending.origin}`,
                            data: {
                                origin: x402pending.origin,
                                transactionHash: receipt.txHash,
                                requestId: receipt.requestId,
                            },
                        })
                            .catch((err) => {
                            console.warn(`[dashclaw-governance] recordPurchaseResult failed: ${errorMessage(err) || 'unknown'}`);
                        });
                    }
                }
                catch (err) {
                    console.warn(`[dashclaw-governance] recordPurchase failed for ${x402pending.origin}: ${errorMessage(err) || 'unknown'}`);
                }
                return;
            }
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
