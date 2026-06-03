import { slackAdapter } from './slack.js';
import { discordAdapter } from './discord.js';
import { linearAdapter } from './linear.js';
import { githubAdapter } from './github.js';
import { emailAdapter } from './email.js';
import { decrypt } from '../encryption.js';

export const ADAPTERS = [
  slackAdapter,
  discordAdapter,
  linearAdapter,
  githubAdapter,
  emailAdapter,
];

/**
 * Deliver signals through all configured and enabled native adapters.
 * @returns {{ provider: string, success: boolean, message: string }[]}
 */
export async function deliverNativeNotifications(orgId, signals, settings, sql) {
  // Settings rows are stored raw (encrypted values are ciphertext); decrypt
  // sensitive values before handing them to adapters, mirroring the read-site
  // decryption in integration-health.js / GET /api/settings. Non-encrypted
  // rows pass through unchanged.
  const creds = {};
  for (const s of settings) {
    let val = s.value;
    if (s.encrypted && val) {
      const decrypted = decrypt(val, `${orgId}:${s.key}`);
      if (decrypted) val = decrypted;
    }
    creds[s.key] = val;
  }

  const results = [];
  for (const adapter of ADAPTERS) {
    const hasKey = adapter.requiredKeys.some(k => creds[k]);
    if (!hasKey) continue;

    const enabledKey = `DASHCLAW_ALERTS_${adapter.name.toUpperCase()}`;
    if (creds[enabledKey] === 'false') continue;

    try {
      const result = await adapter.send(signals, creds, orgId);
      results.push({ provider: adapter.name, ...result });
    } catch (err) {
      results.push({ provider: adapter.name, success: false, message: err.message });
    }
  }
  return results;
}
