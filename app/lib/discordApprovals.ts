/**
 * Discord approval bridge — fires an interactive approval DM to the
 * configured Discord approver when an action enters pending_approval.
 * Mirrors telegramApprovals.js — always fire-and-forget, never throws.
 *
 * Implementation notes:
 * - Uses Discord's REST API (webhook, not gateway) so we stay on Vercel's
 *   free tier (no long-lived websocket).
 * - DM channel id is cached per-process. If a message send returns 403 the
 *   cache entry is invalidated (user may have toggled DM permissions).
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

interface EmbedField {
  name: string;
  value: string;
  inline: boolean;
}

interface DiscordEmbed {
  color: number;
  title: string;
  fields: EmbedField[];
  footer: { text: string };
}

interface DiscordComponent {
  type: number;
  style?: number;
  label?: string;
  custom_id?: string;
  components?: DiscordComponent[];
}

interface DiscordMessagePayload {
  embeds: DiscordEmbed[];
  components: DiscordComponent[];
}

const DISCORD_API = 'https://discord.com/api/v10';
const FETCH_TIMEOUT_MS = 1500;

// Brand orange (#f97316). This is the ONE hex value permitted in-code per
// .impeccable.md because Discord's embed `color` field requires a 24-bit
// int, not a CSS token.
const BRAND_ORANGE = 0xf97316;

// Per-process DM channel cache: approverUserId -> channelId
const dmChannelCache = new Map<string, string>();

function isEnabled(): boolean {
  if (!process.env.DISCORD_BOT_TOKEN) return false;
  if (!process.env.DISCORD_APPROVER_USER_ID) return false;
  if (process.env.DASHCLAW_ALERTS_DISCORD === 'false') return false;
  return true;
}

/**
 * Build the Discord message payload for a pending_approval action.
 * Exported for unit testing (discord-embed-payload.test.js).
 */
export function buildEmbedPayload(action: ApprovalAction): DiscordMessagePayload {
  const risk = action.risk_score ?? 0;
  const reversible = action.reversible === false ? 'irreversible' : 'reversible';
  const goal = (action.declared_goal || '—').slice(0, 200);

  const embed: DiscordEmbed = {
    color: BRAND_ORANGE,
    title: 'DashClaw approval needed',
    fields: [
      { name: 'Agent',      value: action.agent_id || 'unknown',       inline: true },
      { name: 'Action',     value: action.action_type || 'unknown',    inline: true },
      { name: 'Risk score', value: `${risk} • ${reversible}`,          inline: true },
      { name: 'Goal',       value: goal,                               inline: false },
    ],
    footer: { text: action.action_id || '' },
  };

  const components: DiscordComponent[] = [{
    type: 1, // ACTION_ROW
    components: [
      {
        type: 2,         // BUTTON
        style: 3,        // SUCCESS (green)
        label: 'Approve',
        custom_id: `ap:${action.action_id}`,
      },
      {
        type: 2,
        style: 4,        // DANGER (red)
        label: 'Deny',
        custom_id: `dn:${action.action_id}`,
      },
    ],
  }];

  return { embeds: [embed], components };
}

async function openDmChannel(approverUserId: string, token: string): Promise<string | null> {
  const cached = dmChannelCache.get(approverUserId);
  if (cached) return cached;

  const res = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${token}`,
    },
    body: JSON.stringify({ recipient_id: approverUserId }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    console.warn(`[DiscordApprovals] openDmChannel returned ${res.status}`);
    return null;
  }
  const data = await res.json();
  const channelId = data?.id;
  if (channelId) dmChannelCache.set(approverUserId, channelId);
  return channelId;
}

async function sendApprovalMessage(action: ApprovalAction): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN as string;
  const approverUserId = process.env.DISCORD_APPROVER_USER_ID as string;

  const channelId = await openDmChannel(approverUserId, token);
  if (!channelId) return;

  const payload = buildEmbedPayload(action);
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${token}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    console.warn(`[DiscordApprovals] sendMessage returned ${res.status}`);
    // 403 often means the user has DMs disabled or blocked the bot. Clear
    // the cached channel id so the next call re-opens.
    if (res.status === 403) dmChannelCache.delete(approverUserId);
  }
}

/**
 * Fire a Discord approval message for a pending_approval action.
 * Returns a promise so callers can hand it to after() or await it — never
 * rejects (errors are logged and swallowed).
 * @param action - the action record
 * @param _sql - db handle (reserved for v1.1 per-agent routing)
 * @param _orgId - org id (reserved for v1.1 per-agent routing)
 */
export async function fireDiscordApproval(
  action: ApprovalAction,
  _sql?: unknown,
  _orgId?: string
): Promise<void> {
  if (!isEnabled()) return;
  if (action?.status !== 'pending_approval') return;

  try {
    await sendApprovalMessage(action);
  } catch (err) {
    console.warn('[DiscordApprovals] Failed to send approval:', (err as Error)?.message);
  }
}
