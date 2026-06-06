/**
 * Telegram approval bridge — fires an interactive approval message to a
 * configured Telegram admin chat when an action enters pending_approval.
 * Mirrors actionAlerts.js — always fire-and-forget, never throws.
 */

interface ApprovalAction {
  action_id?: string | null;
  agent_id?: string | null;
  action_type?: string | null;
  declared_goal?: string | null;
  risk_score?: number | null;
  reversible?: boolean | null;
  status?: string | null;
}

interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

interface TelegramReplyMarkup {
  inline_keyboard: TelegramInlineButton[][];
}

interface TelegramMessage {
  text: string;
  reply_markup: TelegramReplyMarkup;
}

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const FETCH_TIMEOUT_MS = 1500;

function isEnabled(): boolean {
  if (!process.env.TELEGRAM_BOT_TOKEN) return false;
  if (!process.env.TELEGRAM_ADMIN_CHAT_ID) return false;
  if (process.env.DASHCLAW_ALERTS_TELEGRAM === 'false') return false;
  return true;
}

function buildMessage(action: ApprovalAction): TelegramMessage {
  const risk = action.risk_score ?? 0;
  const reversible = action.reversible === false ? 'irreversible' : 'reversible';
  const goal = (action.declared_goal || '—').slice(0, 200);

  const text = [
    '⏳ DashClaw approval needed',
    '',
    `Agent:   ${action.agent_id || 'unknown'}`,
    `Action:  ${action.action_type || 'unknown'}`,
    `Risk:    ${risk} • ${reversible}`,
    '',
    `Goal: ${goal}`,
    '',
    action.action_id,
  ].join('\n');

  const reply_markup: TelegramReplyMarkup = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `ap:${action.action_id}` },
      { text: '❌ Reject',  callback_data: `dn:${action.action_id}` },
    ]],
  };

  return { text, reply_markup };
}

async function sendApprovalMessage(action: ApprovalAction): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat_id = process.env.TELEGRAM_ADMIN_CHAT_ID;
  const payload = buildMessage(action);

  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, ...payload }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    console.warn(`[TelegramApprovals] sendMessage returned ${res.status}`);
  }
}

/**
 * Fire a Telegram approval message for a pending_approval action.
 * Returns a promise so callers can hand it to after() or await it — never
 * rejects (errors are logged and swallowed).
 * @param action - the action record
 * @param _sql - db handle (reserved for v1.1 per-agent routing)
 * @param _orgId - org id (reserved for v1.1 per-agent routing)
 */
export async function fireTelegramApproval(
  action: ApprovalAction,
  _sql?: unknown,
  _orgId?: string
): Promise<void> {
  if (!isEnabled()) return;
  if (action?.status !== 'pending_approval') return;

  try {
    await sendApprovalMessage(action);
  } catch (err) {
    console.warn('[TelegramApprovals] Failed to send approval:', (err as Error)?.message);
  }
}
