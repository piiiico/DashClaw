import { safeUrlWithIps, buildPinnedDispatcher } from '../webhooks.js';

export const slackAdapter = {
  name: 'slack',
  requiredKeys: ['SLACK_BOT_TOKEN', 'SLACK_WEBHOOK_URL'],

  async send(signals, creds) {
    const redCount = signals.filter(s => s.severity === 'red').length;
    const amberCount = signals.filter(s => s.severity === 'amber').length;

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `DashClaw: ${signals.length} governance signal${signals.length > 1 ? 's' : ''}` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${redCount} critical* · ${amberCount} amber` },
      },
      { type: 'divider' },
      ...signals.slice(0, 5).map(s => ({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${s.severity === 'red' ? ':red_circle:' : ':large_yellow_circle:'} *${s.label}*\n${s.detail}${s.agent_id ? `\n_Agent: ${s.agent_id}_` : ''}`,
        },
      })),
      ...(signals.length > 5 ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: `_...and ${signals.length - 5} more_` },
      }] : []),
    ];

    // Prefer webhook URL (simpler), fall back to bot token + channel
    if (creds.SLACK_WEBHOOK_URL) {
      const validatedIps = await safeUrlWithIps(creds.SLACK_WEBHOOK_URL);
      const dispatcher = buildPinnedDispatcher(validatedIps);
      const res = await fetch(creds.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks }),
        dispatcher,
      });
      if (!res.ok) return { success: false, message: `Slack webhook returned ${res.status}` };
      return { success: true, message: 'Posted via webhook' };
    }

    const channel = creds.SLACK_CHANNEL_ID;
    if (!channel) return { success: false, message: 'No channel configured' };

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, blocks }),
    });
    const data = await res.json();
    if (!data.ok) return { success: false, message: data.error };
    return { success: true, message: `Posted to #${channel}` };
  },
};
